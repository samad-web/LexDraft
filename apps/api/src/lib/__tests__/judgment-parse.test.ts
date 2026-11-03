import { describe, expect, it } from 'vitest';
import {
  cleanJudgmentText,
  formatCite,
  isoDate,
  nameCase,
  neutralCitationFromText,
  parseHcMetadata,
  parseScMetadata,
  splitParagraphs,
} from '../judgment-parse';

// Trimmed from real records in the AWS Open Data buckets.
const SC_RAW = {
  raw_html:
    "<button type='button' role='link' class='btn btn-link p-0 text-start' id='link_10' aria-label=\" Vijay Singh @ Vijay Kr. Sharma versus The State of Bihar pdf\"  class='noToken' href='#'><font size='4'> <strong>VIJAY SINGH @ VIJAY KR. SHARMA<span class='fst-italic'> versus </span>THE STATE OF BIHAR </strong>- <span class='escrText'>[2024] 10 S.C.R. 108</span><span class='ncDisplay'>2024 INSC 735</span><input type='hidden' id='cnr' value=ESCR010004822024></button></font><br><strong>Coram : BELA M. TRIVEDI<sup style=\"color: #268e97;\" class=\"tooltip-sup\" data-tooltip=\"Author\">*</sup>, SATISH CHANDRA SHARMA</strong><br> Issue for Consideration Issue arose &ndash; ss. 302/34<br><strong class='caseDetailsTD' ><span style='color:#212F3D' > Decision Date :</span><font color='green'> 25-09-2024</font><span style='color:#212F3D' > | Case No :</span><font color='green'> CRIMINAL APPEAL No. 1031/2015</font><span style='color:#212F3D' > | Disposal Nature :</span><font color='green'> Disposed off</font>   <span style='color:#212F3D' > |  Bench :</span><font color='green'> 2 Judges</font></strong>",
  path: '2024_10_108_125',
  citation_year: '2024',
  nc_display: '2024INSC735',
};

const HC_RAW = {
  court_code: '33~10',
  court_name: 'Madras High Court',
  raw_html:
    "<button type='button' role='link' class='btn btn-link p-0 text-start' id='link_1945' aria-label=\"HCP/83/2024 of M.KALA .Array[93]. THE SECRETARY TO THE GOVERNMENT pdf\"  class='noToken' href='#'><font size='3'>HCP/83/2024 of M.KALA Vs THE SECRETARY TO THE GOVERNMENT</button></font><br><strong>Judge : HONOURABLE MR JUSTICE M.S. RAMESH,HONOURABLE MR JUSTICE SUNDER MOHAN</strong><br> IN THE HIGH COURT OF JUDICATURE AT MADRAS DATED : 18.04.2024<br><strong class='caseDetailsTD' ><span style='color:#212F3D'> CNR :</span><font color='green'> HCMA010000062024</font><span style='color:#212F3D' > | Date of registration :</span><font color='green'> 18-01-2024</font><span style='color:#212F3D' > | Decision Date :</span><font color='green'> 18-04-2024</font><span style='color:#212F3D' > | Disposal Nature :</span><font color='green'> ALLOWED</font><br><span style='opacity: 0.5;'>Court : Madras High Court</span></strong>",
  pdf_link: 'court/cnrorders/hc_cis_mas/orders/HCMA010000062024_1_2024-04-18.pdf',
};

describe('parseScMetadata', () => {
  it('reads title, citations, coram, date and case number by label', () => {
    const m = parseScMetadata(SC_RAW)!;
    expect(m).toMatchObject({
      sourceKey: 'sc:2024_10_108_125',
      court: 'Supreme Court of India',
      courtCode: 'SC',
      caseTitle: 'Vijay Singh @ Vijay Kr. Sharma v. The State of Bihar',
      caseNumber: 'CRIMINAL APPEAL No. 1031/2015',
      cnr: 'ESCR010004822024',
      neutralCitation: '2024 INSC 735',
      reportedCitations: ['[2024] 10 S.C.R. 108'],
      decisionDate: '2024-09-25',
      bench: 'Bela M. Trivedi, Satish Chandra Sharma',
      benchSize: 2,
      disposal: 'Disposed off',
    });
  });

  it('falls back to nc_display and the upper-case title when the HTML lacks them', () => {
    const html = SC_RAW.raw_html.replace(/aria-label="[^"]*"/, '').replace(/<span class='ncDisplay'>[^<]*<\/span>/, '');
    const m = parseScMetadata({ ...SC_RAW, raw_html: html })!;
    expect(m.caseTitle).toBe('Vijay Singh @ Vijay Kr. Sharma v. The State of Bihar');
    expect(m.neutralCitation).toBe('2024 INSC 735');
  });

  it('returns null without a path or a title', () => {
    expect(parseScMetadata({ raw_html: SC_RAW.raw_html })).toBeNull();
    expect(parseScMetadata({ path: 'x', raw_html: '<div></div>' })).toBeNull();
  });
});

describe('parseHcMetadata', () => {
  it('splits "NUMBER of A Vs B" and strips HONOURABLE MR JUSTICE', () => {
    const m = parseHcMetadata(HC_RAW, 'HCMA010000062024_1_2024-04-18')!;
    expect(m).toMatchObject({
      sourceKey: 'hc:33_10:HCMA010000062024_1_2024-04-18',
      court: 'Madras High Court',
      courtCode: 'MHC',
      caseTitle: 'M.KALA v. THE SECRETARY TO THE GOVERNMENT',
      caseNumber: 'HCP/83/2024',
      cnr: 'HCMA010000062024',
      decisionDate: '2024-04-18',
      bench: 'M.S. Ramesh, Sunder Mohan',
      benchSize: 2,
      disposal: 'ALLOWED',
      neutralCitation: null,
    });
  });

  it('handles a case number with a space and a trailing comma on a party', () => {
    const raw = { ...HC_RAW, raw_html: HC_RAW.raw_html.replace(/<font size='3'>[^<]*/, "<font size='3'>CRL OP/55/2024 of Ramachandran @ Vicky Vs The Inspector of Police,") };
    const m = parseHcMetadata(raw, 'X')!;
    expect(m.caseNumber).toBe('CRL OP/55/2024');
    expect(m.caseTitle).toBe('Ramachandran @ Vicky v. The Inspector of Police');
  });
});

describe('small helpers', () => {
  it('isoDate rejects impossible dates', () => {
    expect(isoDate('25-09-2024')).toBe('2024-09-25');
    expect(isoDate('18.04.2024')).toBe('2024-04-18');
    expect(isoDate('31-02-2024')).toBeNull();
    expect(isoDate('')).toBeNull();
  });

  it('nameCase only touches all-caps names', () => {
    expect(nameCase('BELA M. TRIVEDI')).toBe('Bela M. Trivedi');
    expect(nameCase('M.S. Ramesh')).toBe('M.S. Ramesh');
  });

  it('neutralCitationFromText finds HC and SC forms', () => {
    expect(neutralCitationFromText('... Neutral Citation No. 2024:MHC:1234 ...')).toBe('2024:MHC:1234');
    expect(neutralCitationFromText('[2024] 10 S.C.R. 108 : 2024 INSC 735')).toBe('2024 INSC 735');
    expect(neutralCitationFromText('dated 20.12.2023')).toBeNull();
  });

  it('formatCite: title + citations, else case number / court / date', () => {
    expect(formatCite({ caseTitle: 'A v. B', neutralCitation: '2024 INSC 735', reportedCitations: ['[2024] 10 S.C.R. 108'] }))
      .toBe('A v. B, (2024 INSC 735; [2024] 10 S.C.R. 108)');
    expect(formatCite({ caseTitle: 'A v. B', caseNumber: 'HCP/83/2024', court: 'Madras High Court', decisionDate: '2024-04-18' }))
      .toBe('A v. B, (HCP/83/2024, Madras High Court, 18.04.2024)');
  });
});

describe('cleanJudgmentText', () => {
  it('drops page numbers, footer URLs, SCR running heads and repeated captions', () => {
    const raw = [
      'H.C.P.No.83 of 2024', 'Body line one.', '1', 'https://www.mhc.tn.gov.in/judis', '',
      'H.C.P.No.83 of 2024', 'Body line two.', '[2024] 10 S.C.R.  109', '110 [2024] 10 S.C.R.',
      'Digital Supreme Court Reports', '38/43', 'H.C.P.No.83 of 2024', 'Body line three.',
    ].join('\n');
    expect(cleanJudgmentText(raw).split('\n').filter(Boolean)).toEqual(['Body line one.', 'Body line two.', 'Body line three.']);
  });
});

describe('splitParagraphs', () => {
  it('starts after the JUDGMENT heading, keeps numbering in sequence and stops at the editorial tail', () => {
    const text = [
      'Headnotes', '1. A headnote point that is not the judgment.',
      'Judgment / Order of the Supreme Court', 'Judgment', 'Satish Chandra Sharma, J.',
      '1. On 30.08.1985, Neelam breathed her last. The factum of her death was',
      'discovered later; the brother-', 'in-law lodged a report.',
      '2. The Trial Court charged all seven accused. Reliance was placed on a decision',
      'to', 'contend that witnesses may not come forward.',
      '3. Sub-paragraphs stay with their parent.', '3.1 First sub-point.',
      '1. A numbered list inside a paragraph does not restart numbering.',
      '4. The appeals stand disposed of.',
      'Result of the Case: Appeals disposed of.', 'Headnotes prepared by: X',
    ].join('\n');
    const { paragraphs, numbered } = splitParagraphs(text);
    expect(numbered).toBe(true);
    expect(paragraphs.map((p) => p.paraNo)).toEqual([1, 2, 3, 4]);
    expect(paragraphs.map((p) => p.seq)).toEqual([0, 1, 2, 3]);
    expect(paragraphs[0]!.text).toBe('On 30.08.1985, Neelam breathed her last. The factum of her death was discovered later; the brother-in-law lodged a report.');
    expect(paragraphs[1]!.text).toContain('a decision to contend');
    expect(paragraphs[2]!.text).toContain('3.1 First sub-point. 1. A numbered list');
    expect(paragraphs[3]!.text).toBe('The appeals stand disposed of.');
  });

  it('treats an unnumbered opening as para 1 when numbering starts at 2, and stops at the signature date / copy list', () => {
    const text = [
      'ORDER', 'M.S.RAMESH, J.', 'AND', 'SUNDER MOHAN , J.',
      'The petitioner, mother of the detenu, has come forward with this petition.',
      '2.Heard the learned counsel on both sides.',
      '3.The detention order is set aside.',
      '[M.S.R., J] [S.M., J]', '18.04.2024', 'To', '1.The Secretary to the Government', '2.The Commissioner of Police',
    ].join('\n');
    const { paragraphs } = splitParagraphs(text);
    expect(paragraphs.map((p) => [p.paraNo, p.text])).toEqual([
      [1, 'The petitioner, mother of the detenu, has come forward with this petition.'],
      [2, 'Heard the learned counsel on both sides.'],
      [3, 'The detention order is set aside.'],
    ]);
  });

  it('skips a repeated caption + author line above an un-headed order and stops at a bare date', () => {
    const text = [
      'Crl.O.P.No.163 of 2024', 'C.V.KARTHIKEYAN, J.',
      'The learned Government Advocate stated that the statement had not been recorded.',
      '2. The submission is recorded.', '3. Accordingly, this petition stands dismissed.', '09.01.2024', 'mkn2',
    ].join('\n');
    const { paragraphs } = splitParagraphs(text);
    expect(paragraphs.map((p) => p.paraNo)).toEqual([1, 2, 3]);
    expect(paragraphs[0]!.text).toMatch(/^The learned Government Advocate/);
    expect(paragraphs[2]!.text).toBe('Accordingly, this petition stands dismissed.');
  });

  it('splits a very long paragraph into parts that share its number', () => {
    const long = Array.from({ length: 140 }, (_, i) => `Sentence number ${i} of a long paragraph goes here.`).join(' ');
    const { paragraphs } = splitParagraphs(`JUDGMENT\n1. ${long}\n2. Short.`);
    const ones = paragraphs.filter((p) => p.paraNo === 1);
    expect(ones.length).toBeGreaterThan(1);
    expect(ones.every((p) => p.text.length <= 3_000)).toBe(true);
    expect(paragraphs.at(-1)).toMatchObject({ paraNo: 2, text: 'Short.' });
    expect(paragraphs.map((p) => p.seq)).toEqual(paragraphs.map((_, i) => i));
  });

  it('falls back to sentence chunks when the judgment is not numbered', () => {
    const body = Array.from({ length: 60 }, (_, i) => `Plain sentence ${i} without any numbering at all.`).join('\n');
    const { paragraphs, numbered } = splitParagraphs(`ORDER\n${body}`);
    expect(numbered).toBe(false);
    expect(paragraphs.length).toBeGreaterThan(1);
    expect(paragraphs.map((p) => p.paraNo)).toEqual(paragraphs.map((_, i) => i + 1));
  });
});

describe('rejoinLigatures — SCR ligature glyphs extracted with a space', () => {
  it('rejoins fi / fl / ff splits and leaves real word breaks alone', async () => {
    const { rejoinLigatures } = await import('../judgment-parse');
    expect(rejoinLigatures('The relevant fi ndings; the petition fi led; any off ence; to that eff ect; the fl ow'))
      .toBe('The relevant findings; the petition filed; any offence; to that effect; the flow');
    expect(rejoinLigatures('he went off the road; the staff members; if the court')).toBe('he went off the road; the staff members; if the court');
  });
});
