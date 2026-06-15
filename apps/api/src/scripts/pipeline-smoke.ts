/* eslint-disable no-console */
/**
 * End-to-end smoke test for the per-case pipeline graph + applications
 * (migration 0054). Exercises the same service layer the HTTP routes use.
 *
 *   1. Picks a firm, inserts a temp `cases` row and instantiates its graph.
 *   2. Asserts the graph seeded a linear chain from the type template.
 *   3. Adds a branch node + an edge (with a condition) and advances a node.
 *   4. Asserts cases.stage synced + a case_stage_events audit row was written.
 *   5. Adds three applications with different statuses.
 *   6. Reads the timeline and asserts both stage + application events appear.
 *   7. Deletes the temp case (cascades clean up nodes/edges/applications).
 *
 * Usage: `pnpm --filter @lexdraft/api exec tsx src/scripts/pipeline-smoke.ts`
 * Requires DATABASE_URL set and migration 0054 applied.
 */
import { db, closeDb } from '../db/client';
import { pipelineGraph, instantiateGraph, casePipelineService } from '../services/case-pipeline.service';
import { caseApplicationsService } from '../services/case-applications.service';

const TEMP_TITLE = '[smoke-test] pipeline graph temp matter';
const TEMP_CNR = 'SMOKETEST000PIPE0001';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

async function main() {
  const sql = db();
  if (!sql) {
    console.error('No DATABASE_URL configured — cannot run smoke test');
    process.exit(2);
  }

  const [firm] = await sql<Array<{ id: string; name: string }>>`select id, name from firms limit 1`;
  if (!firm) {
    console.error('No firms in the DB — cannot run smoke test');
    process.exit(3);
  }
  console.log(`→ Using firm ${firm.name} (${firm.id})`);

  await sql`
    delete from cases
    where (firm_id = ${firm.id}::uuid and title = ${TEMP_TITLE}) or cnr = ${TEMP_CNR}
  `;
  const [created] = await sql<Array<{ id: string }>>`
    insert into cases (firm_id, cnr, title, court, stage, client, status, type, kind)
    values (${firm.id}::uuid, ${TEMP_CNR}, ${TEMP_TITLE},
            'High Court', 'Filing', 'Smoke Client', 'Active', 'Civil', 'matter')
    returning id
  `;
  if (!created) { console.error('Could not create temp case'); process.exit(4); }
  const caseId = created.id;
  console.log(`→ Created temp case ${caseId}`);

  try {
    // 1. Instantiate the graph (the create route does this).
    await instantiateGraph(caseId, firm.id, 'Civil', 'Filing');

    // 2. Assert the seeded chain.
    let graph = await pipelineGraph.get(caseId, firm.id);
    console.log(`\n=== seeded graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges ===`);
    for (const n of graph.nodes) console.log(`  [${n.status.padEnd(7)}] ${n.label}`);
    assert(graph.nodes.length >= 8, 'civil template should seed >= 8 nodes');
    assert(graph.edges.length === graph.nodes.length - 1, 'seeded chain should be linear');
    const filing = graph.nodes.find((n) => n.label === 'Filing');
    assert(filing?.status === 'active', 'Filing should be the active node');

    // 3. Add a branch node + an edge with a condition.
    const branch = await pipelineGraph.addNode(caseId, firm.id, { label: 'Mediation', x: 200, y: 180 });
    assert(branch, 'addNode should return a node');
    const issues = graph.nodes.find((n) => n.label === 'Issues');
    assert(issues, 'civil template should contain Issues');
    const edge = await pipelineGraph.addEdge(caseId, firm.id, {
      fromNodeId: issues!.id, toNodeId: branch!.id, conditionLabel: 'if parties agree',
    });
    assert(edge, 'addEdge should return an edge');
    console.log(`\n→ Added branch node "${branch!.label}" + edge "${edge!.conditionLabel}"`);

    // 4. Advance: mark the branch node active → should sync cases.stage + audit.
    const res = await pipelineGraph.setStatus({
      nodeId: branch!.id, firmId: firm.id, status: 'active',
      actor: { id: null, name: 'smoke-test' }, note: 'parked for mediation',
    });
    assert(res, 'setStatus should succeed');
    const [row] = await sql<Array<{ stage: string }>>`select stage from cases where id = ${caseId}::uuid`;
    assert(row?.stage === 'Mediation', `cases.stage should sync to "Mediation", got "${row?.stage}"`);
    const [evt] = await sql<Array<{ to_stage: string; note: string | null }>>`
      select to_stage, note from case_stage_events where case_id = ${caseId}::uuid order by created_at desc limit 1
    `;
    assert(evt?.to_stage === 'Mediation', 'audit row to_stage should be Mediation');
    console.log(`→ Advanced to "${row.stage}" (audit note: "${evt.note}")`);

    // 5. Add three applications with different statuses.
    const seed = [
      { kind: 'ia' as const,     label: 'IA 45/2024',  appType: 'Stay',        status: 'pending' as const,  filedOn: '2024-06-12' },
      { kind: 'ia' as const,     label: 'IA 12/2024',  appType: 'Condonation', status: 'allowed' as const,  filedOn: '2024-03-01', orderOn: '2024-03-03' },
      { kind: 'appeal' as const, label: 'Crl.A 88/24', appType: 'Regular',     status: 'dismissed' as const, filedOn: '2024-04-01', orderOn: '2024-04-21' },
    ];
    for (const s of seed) {
      const app = await caseApplicationsService.create(caseId, firm.id, s);
      assert(app, `create application ${s.label}`);
    }
    const apps = await caseApplicationsService.listForCase(caseId, firm.id);
    console.log(`\n=== applications (${apps.length}) ===`);
    for (const a of apps) console.log(`  ${(a.label ?? '').padEnd(14)} ${a.kind.padEnd(7)} ${a.status}`);
    assert(apps.length === 3, 'should have 3 applications');

    // 6. Timeline should carry both stage + application events.
    const timeline = await casePipelineService.timeline(caseId, firm.id, 'advocate');
    const kinds = new Set(timeline.map((e) => e.kind));
    console.log(`\n=== timeline (${timeline.length} events; kinds: ${[...kinds].join(', ')}) ===`);
    assert(kinds.has('stage'), 'timeline should include a stage event');
    assert(kinds.has('application'), 'timeline should include application events');

    // Portal-scoped applications (all default visible) should also appear.
    const portalApps = await caseApplicationsService.listForCase(caseId, firm.id, { portalOnly: true });
    assert(portalApps.length === 3, 'all 3 applications are portal-visible by default');

    graph = await pipelineGraph.get(caseId, firm.id);
    assert(graph.nodes.some((n) => n.label === 'Mediation'), 'branch node persisted');
    assert(graph.edges.some((e) => e.conditionLabel === 'if parties agree'), 'conditioned edge persisted');

    console.log('\n✔ pipeline smoke test passed');
  } finally {
    await sql`delete from cases where id = ${caseId}::uuid`;
    console.log(`→ Cleaned up temp case ${caseId}`);
    await closeDb();
  }
}

main().catch(async (err) => {
  console.error('✘ smoke test failed:', err);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
