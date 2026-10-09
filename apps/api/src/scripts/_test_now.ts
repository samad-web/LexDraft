import { searchByPartyName } from '../services/ecourts.service';
(async () => {
  const started = Date.now();
  try {
    const r: any = await searchByPartyName({
      stateCode: 4, distCode: 6, courtCode: 0, estCode: '12',
      partyName: 'Kumar', year: 2023, court: 'DC',
    } as any);
    console.log('OK in', ((Date.now()-started)/1000).toFixed(1), 's');
    const est = r?.['0'];
    console.log('establishment:', est?.establishment_name, '| cases:', est?.caseNos?.length ?? 0);
  } catch (e: any) {
    console.log('FAILED after', ((Date.now()-started)/1000).toFixed(1), 's:', e.message);
  }
})();
