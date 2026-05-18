// Sanity-check the upstream corpus quality. Counts chunks where the
// content is heavily corrupted (high ratio of non-letters to letters),
// usually a sign of failed PDF text extraction.
//
// Read-only against LAWS_DATABASE_URL. Safe to run anytime.

import postgres from 'postgres';
import { env } from '../src/env';

async function main(): Promise<void> {
  if (!env.LAWS_DATABASE_URL) {
    console.error('LAWS_DATABASE_URL not set');
    process.exit(2);
  }
  const sql = postgres(env.LAWS_DATABASE_URL, {
    ssl: env.lawsDatabaseSsl ? 'require' : false,
    max: 1,
  });

  try {
    // Overall counts
    const totals = await sql<{ total: bigint }[]>`select count(*) as total from chunks`;
    console.log(`Total chunks: ${totals[0]!.total}`);

    // Garbled = chunks where < 60% of non-space characters are letters/digits/
    // standard punctuation. Anything below that ratio is almost certainly
    // corrupt PDF extraction.
    const rows = await sql<{ act: string; total: bigint; garbled: bigint }[]>`
      with classified as (
        select a.short_title as act,
               c.content,
               (
                 length(regexp_replace(c.content, '[^A-Za-z0-9 .,;:()\\-]', '', 'g'))::float
                 / nullif(length(regexp_replace(c.content, '\\s', '', 'g')), 0)
               ) as letter_ratio
        from chunks c
        join acts a on a.id = c.act_id
      ),
      agg as (
        select act,
               count(*)                                    as total,
               count(*) filter (where letter_ratio < 0.60) as garbled
        from classified
        group by act
      )
      select act, total, garbled
      from agg
      where total > 0
      order by garbled::float / total desc
      limit 20
    `;

    console.log('\nWorst-affected acts (by garble ratio):');
    console.log('Act'.padEnd(60), 'Total'.padStart(8), 'Garbled'.padStart(8), 'Ratio'.padStart(7));
    console.log('-'.repeat(85));
    for (const r of rows) {
      const ratio = Number(r.garbled) / Number(r.total);
      console.log(
        (r.act ?? '<null>').padEnd(60),
        String(r.total).padStart(8),
        String(r.garbled).padStart(8),
        `${(ratio * 100).toFixed(0)}%`.padStart(7),
      );
    }

    // Headline stats: how much of the corpus is unusable in total.
    const overall = await sql<{ total: bigint; garbled: bigint }[]>`
      select count(*) as total,
             count(*) filter (where (
               length(regexp_replace(c.content, '[^A-Za-z0-9 .,;:()\\-]', '', 'g'))::float
               / nullif(length(regexp_replace(c.content, '\\s', '', 'g')), 0)
             ) < 0.60) as garbled
      from chunks c
    `;
    const t = Number(overall[0]!.total);
    const g = Number(overall[0]!.garbled);
    console.log(`\nOverall: ${g} / ${t} chunks garbled (${(g / t * 100).toFixed(1)}%)`);

    // Per-act count: how many acts have at least some garbled content?
    const actCounts = await sql<{ total_acts: bigint; affected_acts: bigint; all_garbled: bigint }[]>`
      with by_act as (
        select c.act_id,
               count(*) as total,
               count(*) filter (where (
                 length(regexp_replace(c.content, '[^A-Za-z0-9 .,;:()\\-]', '', 'g'))::float
                 / nullif(length(regexp_replace(c.content, '\\s', '', 'g')), 0)
               ) < 0.60) as garbled
        from chunks c
        group by c.act_id
      )
      select count(*) as total_acts,
             count(*) filter (where garbled > 0) as affected_acts,
             count(*) filter (where garbled = total) as all_garbled
      from by_act
    `;
    console.log(
      `Acts: ${actCounts[0]!.total_acts} total · ` +
      `${actCounts[0]!.affected_acts} with any garbled content · ` +
      `${actCounts[0]!.all_garbled} fully unusable`,
    );

    // One sample of a garbled chunk so the user can see the pattern.
    const sample = await sql<{ act: string; content: string }[]>`
      select a.short_title as act, c.content
      from chunks c
      join acts a on a.id = c.act_id
      where (
        length(regexp_replace(c.content, '[^A-Za-z0-9 .,;:()\\-]', '', 'g'))::float
        / nullif(length(regexp_replace(c.content, '\\s', '', 'g')), 0)
      ) < 0.40
      order by random()
      limit 1
    `;
    if (sample[0]) {
      console.log('\nSample garbled chunk:');
      console.log(`  Act: ${sample[0].act}`);
      console.log('  ' + sample[0].content.slice(0, 240).replace(/\s+/g, ' '));
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('uncaught', err);
  process.exit(1);
});
