// Read-only smoke check of the Pre Trial Application search.
// Usage: tsx src/scripts/ecourts-pretrial-smoke.ts <state> <dist> <court> <policeSt> [R|B]
import { searchPreTrial, listPoliceStations } from '../services/ecourts.service';

async function main() {
  const [state = '4', dist = '2', court = '1', ps, type = 'R'] = process.argv.slice(2);
  const stations = await listPoliceStations(Number(state), Number(dist), Number(court));
  console.log(`police stations: ${stations.length}`, stations.slice(0, 3));
  const policeStCode = Number(ps ?? stations[0]?.code);
  const r = await searchPreTrial({
    stateCode: Number(state), distCode: Number(dist), courtCode: Number(court),
    applicationType: type === 'B' ? 'B' : 'R', policeStCode, firType: '0',
  });
  console.log(JSON.stringify({ policeStCode, establishments: r.establishments.map((e) => ({ ...e, rows: e.rows.slice(0, 2), orders: e.orders.slice(0, 2), rowCount: e.rows.length, orderCount: e.orders.length })) }, null, 2));
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
