import { createRoot } from 'react-dom/client';
import { QrPrintCenter } from '../../../src/modules/owner/pages/OwnerDashboardPage';
import '../../../src/modules/owner/styles/ownerDashboard.css';

const params = new URLSearchParams(location.search);
const validLogo = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" fill="white"/><text x="60" y="28" font-family="Arial" font-size="24" text-anchor="middle">ROYAL</text></svg>');
const logoUrl = params.get('logo') === 'missing' ? '' : params.get('logo') === 'broken' ? '/fixtures/no-such-logo.png' : validLogo;
const count = Number(params.get('count') || 6);
const rows = Array.from({ length: count }, (_, index) => {
  const number = index === 5 ? 100 : index + 1;
  return {
    table: { id:`print-fixture-${number}`,restaurant_id:'fixture',table_number:number,label:`Table ${number}`,active:true,qr_token:'',qr_url:'',qr_path:'',qr_created_at:null,qr_regenerated_at:null },
    disabled:false,qrReady:true,
    // Already-resolved, synthetic capability, never a production/demo token.
    orderingResolution:{url:`https://example.invalid/r/print-fixture/order?t=${number}&qr=00000000-0000-4000-8000-000000000000`,unavailableMessage:null},
  };
});
createRoot(document.getElementById('fixture')!).render(<div className="od-root"><QrPrintCenter
  restaurantName={params.get('name') === 'long' ? 'Grand Royal Restaurant Café and Hospitality Conference Garden' : 'GRAND ROYAL'}
  logoUrl={logoUrl} rows={rows} onClose={() => { document.body.dataset.closed='true'; }}
/></div>);
