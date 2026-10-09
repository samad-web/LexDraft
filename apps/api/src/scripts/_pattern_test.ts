import { searchByPartyName } from '../services/ecourts.service';
(async () => {
  const names = ['Ramesh', 'Sunil', 'Anitha', 'Mohan', 'Kumar'];
  for (const name of names) {
    try {
      const r: any = await searchByPartyName({
        stateCode: 4, distCode: 6, courtCode: 0, estCode: '12',
        partyName: name, year: 2023, court: 'DC',
      } as any);
      const est = r?.['0'];
      console.log(name, '=>', est?.caseNos?.length ?? 0, 'cases');
    } catch (e: any) {
      console.log(name, '=> THREW', e.message);
    }
  }
})();
