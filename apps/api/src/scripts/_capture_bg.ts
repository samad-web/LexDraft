import { searchByPartyName } from '../services/ecourts.service';
import { writeFileSync, appendFileSync } from 'node:fs';

const complexes: Record<string, string[]> = {
  '1040058': ['19'],
  '1040059': ['35'],
  '1040060': ['7','8','27'],
  '1040061': ['12','13','14','15','30','31','42','45','46'],
  '1040062': ['21','22','23','24','25','33','34','41'],
  '1040063': ['37'],
  '1040065': ['36'],
  '1040066': ['1','2','3','4','5','6','20','29','32','40','47'],
  '1040068': ['9','10','28','39'],
  '1040069': ['11'],
  '1040070': ['38'],
  '1040071': ['16','17','18','26','43','44'],
};

async function main() {
  writeFileSync('/tmp/court_names.jsonl', '');
  for (const [complexCode, codes] of Object.entries(complexes)) {
    for (const cc of codes) {
      try {
        const r: any = await searchByPartyName({
          stateCode: 4, distCode: 6, courtCode: 0, estCode: cc,
          partyName: 'zzzznomatchxyz', year: 2023, court: 'DC',
        } as any);
        const name = r?.['0']?.establishment_name ?? 'UNKNOWN';
        appendFileSync('/tmp/court_names.jsonl', JSON.stringify({ complex: complexCode, code: cc, name }) + '\n');
      } catch (e: any) {
        appendFileSync('/tmp/court_names.jsonl', JSON.stringify({ complex: complexCode, code: cc, name: 'ERROR: ' + e.message }) + '\n');
      }
    }
  }
  appendFileSync('/tmp/court_names.jsonl', 'DONE\n');
}
main();
