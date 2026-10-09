import { call } from '../lib/ecourts';
(async () => {
  const attempts = [
    { label: 'court_code_arr empty string', params: { state_code:4, dist_code:6, court_code:0, court_code_arr:'', pet_name:'Kumar', year:2023, bilingual_flag:0 } },
    { label: 'court_code_arr omitted entirely', params: { state_code:4, dist_code:6, court_code:0, pet_name:'Kumar', year:2023, bilingual_flag:0 } },
  ];
  for (const { label, params } of attempts) {
    try {
      const r = await call('searchByPartyName.php', { court: 'DC', params });
      console.log(label, '=>', JSON.stringify(r).slice(0, 200));
    } catch (e: any) {
      console.log(label, '=> THREW', e.message);
    }
  }
})();
