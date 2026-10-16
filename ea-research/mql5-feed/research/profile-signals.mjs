// Behaviour profile of a few live signals from their public pages (aggregate stats only).
const IDS = {'FXtrading (MT5)':2356441,'EA Happy News (MT4)':1864588,'NebulaEA (MT4)':2332163,'Harmonizer Extreme (MT5)':2360068,'One Man Army Double Shot (MT5)':2338672,'Hari Ke 7 (MT4)':2371938,'Lenochkin (MT4)':2367841,'Precise Pair Trading Pro (MT5)':2329290};
const UA = 'Mozilla/5.0 (compatible; AT24-research-feed; personal R&D archive)';
const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&nbsp;|&#xA0;/g, ' ').replace(/\s+/g, ' ').trim();
for (const [name, id] of Object.entries(IDS)) {
  const r = await fetch(`https://www.mql5.com/en/signals/${id}`, { headers: { 'user-agent': UA, 'accept-language': 'en' } });
  const t = await r.text();
  const pairs = [...t.matchAll(/s-data-columns__label">([\s\S]*?)<\/div>\s*<div class="s-data-columns__value">([\s\S]*?)<\/div>/g)].map((m) => [strip(m[1]).replace(/:$/, ''), strip(m[2])]);
  const want = /holding|trades per week|long|short|average profit|average loss|best|worst|profit trades|loss trades|max.*consecutive|expected|profit factor|recovery|sharpe|drawdown|deposit load|trades$|lots/i;
  const keep = pairs.filter(([k]) => want.test(k)).slice(0, 26);
  const desc = strip((t.match(/signal-info__description[^>]*>([\s\S]*?)<\/div>/) || t.match(/class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [, ''])[1]).slice(0, 380);
  const hours = [...t.matchAll(/data-hour="(\d+)"[^>]*data-value="([\d.]+)"/g)].length;
  console.log(`\n=== ${name} (id ${id}) status ${r.status}`);
  keep.forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  if (desc) console.log('  AUTHOR:', desc);
  await new Promise((x) => setTimeout(x, 4000));
}
