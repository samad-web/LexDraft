import { searchByPartyName } from '../services/ecourts.service';
(async () => {
  const r = await searchByPartyName({
    stateCode: 4, distCode: 6, courtCode: 0, estCode: '12',
    partyName: 'Shahul hameed', year: 2021, court: 'DC',
  } as any);
  console.log('FULL RAW:', JSON.stringify(r, null, 2));
})();
