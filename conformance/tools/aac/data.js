// The aac model's rows: a seeded generator in the shape of analytics-as-code's nem lakehouse
// (AEMO's National Electricity Market), small enough to ship as M literals. The real tables
// hold every 5-minute interval since 2018; this sample is a slice of them:
//
//   - 17 days of facts, 2026-07-28 to 2026-08-13 (the newest day, still filling), and of
//     each day three 5-minute intervals only: 04:00, 12:00 and 19:00 (time 400, 1200, 1900).
//   - The daily tables hold the whole days: fct_summary_daily (and fct_curtailment) to
//     2026-08-11, fct_region_daily a day further, to 2026-08-12, as the regional table runs
//     ahead of the units' for some hours each night. The measures add the 5-minute rows of
//     the days after.
//   - The daily rows are the sums and averages of the sampled 5-minute rows, so a measure
//     answers the same energy from either table, as the real model does.
//   - The hour-of-day tables hold whole months, June and July 2026, at the sampled hours
//     (4, 12, 19).
//   - fct_region's wind and solar columns are blank before August, as the real ones are
//     before the intraday record starts (2026-08).
//   - An interval at 0 MW is not stored in fct_summary; a battery charging is negative.
//   - Keys: every fct_summary unit is in dim_duid (the model relies on it), as in the real
//     data; fct_curtailment has a farm dim_duid lacks (WRSF1) and fct_interconnector a link
//     dim_interconnector lacks (N-Q-MNSP1), the cases the page's compiler adds a dimension's
//     blank row for. dim_duid has units with no rows (a retired one, a WA one) and
//     dim_region a region with no prices (WA1).
//   - The newest interval has no demand yet for TAS1.
//
// Each table: rows as objects keyed by the source column names; build.mjs orders them by the
// model's columns. Dates are 'YYYY-MM-DD', date-times 'YYYY-MM-DD HH:MM:SS'.

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86400000;
const iso = t => new Date(t).toISOString().slice(0, 10);
const ms = d => Date.parse(`${d}T00:00:00Z`);
const daysFrom = (first, last) => { const out = []; for (let t = ms(first); t <= ms(last); t += DAY) out.push(iso(t)); return out; };
const round = (x, n) => { const f = 10 ** n; return Math.round(x * f) / f; };
const hhmm = time => `${String(Math.floor(time / 100)).padStart(2, '0')}:${String(time % 100).padStart(2, '0')}:00`;

export const CALENDAR = ['2026-06-01', '2026-12-31'];
export const FACT_DAYS = ['2026-07-28', '2026-08-13'];
export const UNITS_WHOLE = '2026-08-11';    // the newest day fct_summary_daily holds
export const REGIONS_WHOLE = '2026-08-12';  // the newest day fct_region_daily holds
export const TIMES = [400, 1200, 1900];
export const MONTHS = [['2026-06-01', 30], ['2026-07-01', 31]];

const REGIONS = [['NSW1', 'New South Wales'], ['QLD1', 'Queensland'], ['SA1', 'South Australia'],
  ['TAS1', 'Tasmania'], ['VIC1', 'Victoria'], ['WA1', 'Western Australia']];
const NEM = REGIONS.filter(([r]) => r !== 'WA1').map(([r]) => r);
const STATE = Object.fromEntries(REGIONS);

// The units: [DUID, Region, fuel, participant, station, technology, classification, CO2e factor,
// renewable, registered MW, max MW, storage MWh, latitude, longitude, storage, owner].
const ROOFTOP_OWNER = 'Rooftop solar (AEMO estimate)';
const UNITS = [
  ['BW01', 'NSW1', 'Black coal', 'AGL Macquarie Pty Limited', 'Bayswater Power Station', 'Steam Sub-Critical', 'Scheduled', 0.882, false, 685, 685, null, -32.3954, 150.9493, false],
  ['BW02', 'NSW1', 'Black coal', 'AGL Macquarie Pty Limited', 'Bayswater Power Station', 'Steam Sub-Critical', 'Scheduled', 0.882, false, 685, 685, null, -32.3954, 150.9493, false],
  ['LIDDELL1', 'NSW1', 'Black coal', 'AGL Macquarie Pty Limited', 'Liddell Power Station', null, null, 1.018, false, 500, 500, null, -32.3714, 150.9781, false],
  ['BROKENH1', 'NSW1', 'Solar', 'Broken Hill Solar Plant Pty Ltd', 'Broken Hill Solar Plant', 'Photovoltaic Flat panel', 'Semi-Scheduled', 0, true, 53, 53, null, -31.9824, 141.4213, false],
  ['STAN-1', 'QLD1', 'Black coal', 'Stanwell Corporation Limited', 'Stanwell Power Station', 'Steam Sub-Critical', 'Scheduled', 0.851, false, 365, 365, null, -23.5106, 150.3197, false],
  ['QLDLOAD1', 'QLD1', null, null, null, null, null, null, false, null, null, null, null, null, false],
  ['LYA1', 'VIC1', 'Brown coal', 'AGL Loy Yang Marketing Pty Ltd', 'Loy Yang A Power Station', 'Steam Sub-Critical', 'Scheduled', 1.163, false, 560, 560, null, -38.2558, 146.5772, false],
  ['BALDHWF1', 'VIC1', 'Wind', 'Bald Hills Wind Farm Pty Ltd', 'Bald Hills Wind Farm', 'Wind - Onshore', 'Semi-Scheduled', 0, true, 106.6, 106.6, null, -38.7608, 145.9483, false],
  ['HDWF1', 'SA1', 'Wind', 'Hornsdale Wind Farm Pty Ltd', 'Hornsdale Wind Farm', 'Wind - Onshore', 'Semi-Scheduled', 0, true, 102.4, 102.4, null, -33.0911, 138.5283, false],
  ['HPR1', 'SA1', 'Grid', 'Hornsdale Power Reserve Pty Ltd', 'Hornsdale Power Reserve', 'Battery Storage', 'Scheduled', null, false, 150, 150, 193.5, -33.0857, 138.5181, true],
  ['TORRB1', 'SA1', 'Natural Gas (Pipeline)', 'AGL SA Generation Pty Limited', 'Torrens Island Power Station B', 'Steam Sub-Critical', 'Scheduled', 0.634, false, 200, 200, null, -34.8061, 138.5208, false],
  ['PTSTAN1', 'SA1', 'Diesel', 'Snowy Hydro Limited', 'Port Stanvac Power Station', 'Compression Reciprocating Engine', 'Scheduled', 0.775, false, 57.6, 57.6, null, -35.1047, 138.4872, false],
  ['GORDON', 'TAS1', 'Hydro', 'Hydro-Electric Corporation', 'Gordon Power Station', 'Hydro - Gravity', 'Scheduled', 0, true, 432, 432, null, -42.7353, 146.0381, false],
  ['MUJA_G7', 'WA1', 'Coal', 'Synergy', null, null, null, null, false, 211, 211, null, -33.4447, 116.3075, false],
  ...NEM.map(r => [`ROOFTOP_${r}`, r, 'Rooftop solar', null, null, null, null, null, true, null, null, null, null, null, false]),
];

export function generate() {
  const rnd = mulberry32(20261013);
  const between = (lo, hi) => lo + rnd() * (hi - lo);
  const chance = p => rnd() < p;

  const dim_duid = UNITS.map(([DUID, Region, FuelSourceDescriptor, Participant, StationName, TechnologyType, Classification,
    CO2eFactor, Renewable, RegCapMW, MaxCapMW, StorageMWh, latitude, longitude, Storage]) => ({
    DUID, Region, State: STATE[Region], FuelSourceDescriptor, Participant, StationName, TechnologyType, Classification,
    CO2eFactor, Renewable, RegCapMW, MaxCapMW, StorageMWh, latitude, longitude, Storage,
    Plant: StationName ?? DUID,
    Owner: FuelSourceDescriptor === 'Rooftop solar' ? ROOFTOP_OWNER : Participant,
  }));
  const regionOf = Object.fromEntries(dim_duid.map(u => [u.DUID, u.Region]));

  const dim_calendar = daysFrom(...CALENDAR).map(date => ({ date, year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) }));
  const dim_time = [];
  for (let minute = 0; minute < 1440; minute += 5) dim_time.push({ time: Math.floor(minute / 60) * 100 + (minute % 60), minute, hour: Math.floor(minute / 60) });
  const dim_region = REGIONS.map(([Region, State]) => ({ Region, State }));
  const dim_month = MONTHS.map(([month, days]) => ({ month, days }));
  const LINKS = [
    ['NSW1-QLD1', 'NSW1', 'QLD1', 'Queensland to New South Wales Interconnector (QNI)', 900, -1200],
    ['VIC1-NSW1', 'VIC1', 'NSW1', 'Victoria to New South Wales Interconnector', 1300, -1100],
    ['V-SA', 'VIC1', 'SA1', 'Heywood Interconnector', 600, -550],
    ['T-V-MNSP1', 'TAS1', 'VIC1', 'Basslink', 478, -478],
    ['V-S-MNSP1', 'VIC1', 'SA1', 'Murraylink', 220, -200],
  ];
  const ORPHAN_LINK = ['N-Q-MNSP1', 'NSW1', 'QLD1', 'Directlink', 180, -210];
  const dim_interconnector = LINKS.map(([interconnector, from_region, to_region, description]) => ({ interconnector, from_region, to_region, description }));

  const days = daysFrom(...FACT_DAYS);
  const august = d => d >= '2026-08-01';
  const newest = { date: FACT_DAYS[1], time: TIMES[TIMES.length - 1] };

  // --- fct_region: price, demand and interchange per region and interval ---
  const DEMAND = { NSW1: [6600, 6900, 10000], QLD1: [5500, 5200, 7400], SA1: [1100, 750, 1700], TAS1: [1000, 1050, 1300], VIC1: [4600, 4300, 6600] };
  const NET = { NSW1: [-800, -150], QLD1: [350, 1200], SA1: [-450, 300], TAS1: [-420, 460], VIC1: [-300, 800] };
  const WIND = { NSW1: 3000, QLD1: 700, SA1: 2100, TAS1: 550, VIC1: 3100 };
  const SOLAR = { NSW1: 5200, QLD1: 5000, SA1: 650, TAS1: 0, VIC1: 1600 };
  const spikes = new Set(['2026-08-04', '2026-08-10']);  // cold, still evenings: SA1 at the cap
  const price = {};   // `${region} ${date} ${time}` -> price
  const windDay = {}; // `${region} ${date}` -> 0..1
  const fct_region = [];
  for (const date of days) {
    for (const r of NEM) windDay[`${r} ${date}`] = between(0.05, 0.95);
    for (const [i, time] of TIMES.entries()) {
      for (const r of NEM) {
        let p;
        if (time === 400) p = between(55, 115);
        else if (time === 1200) p = r === 'SA1' || r === 'VIC1' ? between(-45, 55) : r === 'TAS1' ? between(35, 95) : between(-10, 90);
        else p = between(110, 340);
        if (time === 1900 && r === 'SA1' && spikes.has(date)) p = between(1800, 3100);
        price[`${r} ${date} ${time}`] = round(p, 2);
        const w = windDay[`${r} ${date}`];
        const wa = WIND[r] * w * between(0.85, 1.1), sa = time === 1200 ? SOLAR[r] * between(0.4, 1) : 0;
        fct_region.push({
          REGIONID: r, date, time, price: round(p, 2),
          demand: r === 'TAS1' && date === newest.date && time === newest.time ? null : round(DEMAND[r][i] * between(0.92, 1.08), 2),
          net_interchange: round(between(...NET[r]), 2),
          wind_available: august(date) ? round(wa, 2) : null,
          wind_curtailed: august(date) ? round(wa * (time === 1200 ? between(0, 0.15) : between(0, 0.04)), 2) : null,
          solar_available: august(date) ? round(sa, 2) : null,
          solar_curtailed: august(date) ? round(sa * between(0, 0.2), 2) : null,
        });
      }
    }
  }

  // --- fct_summary: MW per unit and interval, at its region's price ---
  const mwOf = (duid, date, time) => {
    const r = regionOf[duid], w = windDay[`${r} ${date}`];
    switch (duid) {
      case 'BW01': return time === 1900 ? between(600, 685) : time === 1200 ? between(300, 480) : between(450, 600);
      case 'BW02': return date >= '2026-08-03' && date <= '2026-08-06' ? 0 : time === 1900 ? between(590, 680) : time === 1200 ? between(310, 470) : between(440, 590);
      case 'STAN-1': return between(280, 365);
      case 'LYA1': return time === 1200 ? between(430, 520) : between(480, 560);
      case 'BALDHWF1': case 'HDWF1': { const mw = 104 * w * between(0.6, 1.05); return mw < 4 ? 0 : Math.min(mw, 102); }
      case 'HPR1': return time === 1200 ? -between(60, 150) : time === 1900 ? between(40, 150) : chance(0.4) ? 0 : between(-25, 12);
      case 'TORRB1': return time === 1900 ? between(110, 200) : time === 1200 ? (chance(0.3) ? between(40, 80) : 0) : (chance(0.5) ? between(40, 70) : 0);
      case 'PTSTAN1': return time === 1900 && spikes.has(date) ? between(40, 57) : 0;
      case 'GORDON': return time === 1900 ? between(200, 432) : time === 1200 ? (chance(0.5) ? between(50, 150) : 0) : 0;
      case 'BROKENH1': return time === 1200 ? between(18, 53) : 0;
      case 'QLDLOAD1': return chance(0.5) ? between(0.4, 3.2) : 0;
      default: {
        if (!duid.startsWith('ROOFTOP_') || time !== 1200) return 0;
        const peak = { NSW1: 2600, QLD1: 2900, SA1: 1100, TAS1: 150, VIC1: 1800 }[r];
        return peak * between(0.45, 1);
      }
    }
  };
  const FACT_UNITS = dim_duid.filter(u => u.Region !== 'WA1' && u.DUID !== 'LIDDELL1').map(u => u.DUID);
  const fct_summary = [];
  for (const date of days) {
    const written = date <= UNITS_WHOLE ? `${iso(ms(date) + DAY)} 04:00:00` : null;
    for (const time of TIMES) {
      for (const DUID of FACT_UNITS) {
        const mw = round(mwOf(DUID, date, time), 3);
        if (mw === 0) continue;
        fct_summary.push({ date, time, DUID, mw, price: price[`${regionOf[DUID]} ${date} ${time}`],
          cutoff: written ?? `${date} ${hhmm(time)}` });
      }
    }
  }

  // --- The daily tables: the whole days, from the sampled intervals ---
  const fct_region_daily = [];
  for (const date of days.filter(d => d <= REGIONS_WHOLE)) {
    for (const r of NEM) {
      const rows = fct_region.filter(x => x.REGIONID === r && x.date === date);
      const avg = c => round(rows.reduce((s, x) => s + x[c], 0) / rows.length, 4);
      fct_region_daily.push({ REGIONID: r, date, price: avg('price'), demand: avg('demand'), net_interchange: avg('net_interchange') });
    }
  }
  const dayPrice = Object.fromEntries(fct_region_daily.map(x => [`${x.REGIONID} ${x.date}`, x.price]));
  const fct_summary_daily = [];
  for (const date of days.filter(d => d <= UNITS_WHOLE)) {
    for (const DUID of FACT_UNITS) {
      const rows = fct_summary.filter(x => x.DUID === DUID && x.date === date);
      if (!rows.length) continue;
      const sum = f => rows.reduce((s, x) => s + f(x), 0);
      fct_summary_daily.push({
        DUID, date,
        mwh: round(sum(x => x.mw) / 12, 4),
        price: dayPrice[`${regionOf[DUID]} ${date}`],
        output_mwh: round(sum(x => Math.max(x.mw, 0)) / 12, 6),
        charging_mwh: round(sum(x => Math.min(x.mw, 0)) / 12, 6),
        revenue: round(sum(x => Math.max(x.mw, 0) * x.price) / 12, 6),
      });
    }
  }

  // --- The hour-of-day tables: whole months, at the sampled hours ---
  const HOURS = TIMES.map(t => Math.floor(t / 100));
  const fct_summary_hourly = [];
  for (const [month, n] of MONTHS) {
    const sample = Array.from({ length: 6 }, (_, k) => `${month.slice(0, 8)}${String(3 + 5 * k).padStart(2, '0')}`);
    for (const DUID of FACT_UNITS) {
      for (const [i, hour] of HOURS.entries()) {
        // A month's energy at an hour: its days times a typical output then, charging left out.
        const typical = sample.reduce((s, d) => { windDay[`${regionOf[DUID]} ${d}`] ??= between(0.05, 0.95); return s + Math.max(mwOf(DUID, d, TIMES[i]), 0); }, 0) / sample.length;
        if (typical === 0) continue;
        fct_summary_hourly.push({ DUID, month, hour, mwh: round(typical * n, 2) });
      }
    }
  }
  const fct_region_hourly = [];
  for (const [month, n] of MONTHS) {
    for (const r of NEM) {
      for (const hour of HOURS) {
        const p = hour === 4 ? between(60, 110) : hour === 12 ? (r === 'SA1' || r === 'VIC1' ? between(-5, 45) : between(25, 80)) : between(140, 290);
        fct_region_hourly.push({ REGIONID: r, month, hour, price: round(p, 4), intervals: n * 12 });
      }
    }
  }

  // --- Curtailment: per farm and whole day, and per region, day and fuel ---
  const FARMS = [['BALDHWF1', 'VIC1', 'Wind', 2550], ['HDWF1', 'SA1', 'Wind', 2450], ['BROKENH1', 'NSW1', 'Solar', 290], ['WRSF1', 'NSW1', 'Solar', 250]];
  const fct_curtailment = [];
  for (const date of days.filter(d => d <= UNITS_WHOLE)) {
    for (const [DUID, r, fuel, max] of FARMS) {
      const available = max * (fuel === 'Wind' ? windDay[`${r} ${date}`] * between(0.8, 1.05) : between(0.35, 0.95));
      const share = chance(0.25) ? 0 : fuel === 'Solar' ? between(0, 0.22) : between(0, 0.09);
      fct_curtailment.push({ DUID, date, curtailed_mwh: round(available * share, 2), available_mwh: round(available, 2) });
    }
  }
  const fct_curtailment_region = [];
  for (const date of days) {
    if (date <= UNITS_WHOLE) {
      const groups = new Map();
      for (const [DUID, r, fuel] of FARMS) {
        const row = fct_curtailment.find(x => x.DUID === DUID && x.date === date);
        const g = groups.get(`${r} ${fuel}`) ?? groups.set(`${r} ${fuel}`, { REGIONID: r, date, fuel, curtailed_mwh: 0, available_mwh: 0, source: 'farms' }).get(`${r} ${fuel}`);
        g.curtailed_mwh = round(g.curtailed_mwh + row.curtailed_mwh, 2);
        g.available_mwh = round(g.available_mwh + row.available_mwh, 2);
      }
      fct_curtailment_region.push(...groups.values());
    } else {
      for (const r of NEM) {
        const rows = fct_region.filter(x => x.REGIONID === r && x.date === date);
        for (const [fuel, cur, avail] of [['Wind', 'wind_curtailed', 'wind_available'], ['Solar', 'solar_curtailed', 'solar_available']]) {
          const a = rows.reduce((s, x) => s + x[avail], 0) / 12;
          if (a > 0) fct_curtailment_region.push({ REGIONID: r, date, fuel, curtailed_mwh: round(rows.reduce((s, x) => s + x[cur], 0) / 12, 2), available_mwh: round(a, 2), source: 'aemo' });
        }
      }
    }
  }

  // --- fct_interconnector: flow and limits per link and interval ---
  const fct_interconnector = [];
  for (const date of days) {
    for (const time of TIMES) {
      for (const [interconnector, , , , exp, imp] of [...LINKS, ORPHAN_LINK]) {
        // Basslink is out for two days: no flow, its limits closed on each other.
        if (interconnector === 'T-V-MNSP1' && (date === '2026-08-05' || date === '2026-08-06')) {
          fct_interconnector.push({ interconnector, date, time, mw: 0, export_limit: 0, import_limit: 0 });
          continue;
        }
        const export_limit = round(exp * between(0.75, 1), 2), import_limit = round(imp * between(0.75, 1), 2);
        const mw = round(between(import_limit, export_limit) * between(0.5, 1), 2);
        fct_interconnector.push({ interconnector, date, time, mw, export_limit, import_limit });
      }
    }
  }

  return {
    dim_calendar, dim_duid, fct_summary, dim_region, dim_time, fct_region, fct_interconnector, dim_interconnector,
    fct_curtailment, fct_curtailment_region, fct_summary_daily, fct_region_daily, dim_month, fct_summary_hourly, fct_region_hourly,
  };
}
