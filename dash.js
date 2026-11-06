(function () {
  const OFF = 'sem conexão';
  const nf = n => Math.round(n).toLocaleString('pt-BR');
  const mf = n => Number(n).toFixed(2).replace('.', ',');
  const money = n => {
    const v = Number(n);
    const cents = Math.round(Math.abs(v) * 100) % 100 !== 0;
    return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
  };
  const attr = s => String(s).replace(/"/g, '&quot;');
  const help = t => `<span class="help" tabindex="0" data-tip="${attr(t)}" aria-label="${attr(t)}">?</span>`;
  const SL = { ok: 'No ritmo', warn: 'Quase lá', bad: 'Fora do ritmo', wait: 'Aguardando' };
  const KW = { ok: 'Bateu', warn: 'Quase', bad: 'Não bateu' };
  const pill = s => `<span class="pill s-${s}"><i></i>${SL[s]}</span>`;
  const G = {
    ativo: 'Entregador que, nos últimos 7 dias, fez pelo menos uma coleta ou recebeu pelo menos uma oferta com o Grana Certa.',
    ativoPeriodo: 'Entregador que fez pelo menos uma coleta no período selecionado.',
    rodando: 'Usuário ativo com coleta ou oferta recebida nos últimos 15 minutos.',
    novo: 'Ativo neste período que não estava ativo no período anterior.',
    retido: 'Ativo neste período e também no período anterior.',
    perdido: 'Estava ativo no período anterior e não está neste.',
    metaSem: 'Número que precisa estar batido no fim da semana.',
    metaHoje: 'Parte da meta da semana que já deveria estar batida hoje, distribuída dia a dia.',
    tempo: 'Média do tempo que os entregadores esperaram nas lojas no período. Quanto menor, melhor.',
  };
  const FS = [
    ['Fizeram login', 'Criaram a conta neste período, com e-mail. Uma pessoa por conta.'],
    ['Ativaram a acessibilidade', 'Desses novos logins, quantos estão com a acessibilidade ligada agora.'],
    ['Viraram ativos', 'Desses novos logins, quantos fizeram a primeira coleta neste período.'],
  ];
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const pf = n => (Math.round(Number(n) * 10) / 10).toFixed(1).replace('.', ',');
  const pp = n => (Math.round(Number(n) * 10) / 10).toFixed(1).replace('.', ',');
  const big = (value, html) => value == null ? '<span class="big nc">sem conexão</span>' : `<span class="big">${html}</span>`;

  function statusOf(real, meta, lower) {
    if (real == null || meta == null || !isFinite(real) || !isFinite(meta)) return null;
    if (!lower && meta <= 0) return real <= 0 ? 'ok' : 'ok';
    if (lower && real <= 0) return 'ok';
    const r = lower ? meta / real : real / meta;
    if (!isFinite(r)) return null;
    if (r >= 1) return 'ok';
    if (r >= 0.9) return 'warn';
    return 'bad';
  }

  function linreg(points) {
    const n = points.length;
    if (n < 2) return { slope: 0, intercept: points[0] ? points[0].y : 0 };
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    points.forEach(p => { sx += p.x; sy += p.y; sxy += p.x * p.y; sxx += p.x * p.x; });
    const denom = (n * sxx - sx * sx) || 1;
    const slope = (n * sxy - sx * sy) / denom;
    return { slope, intercept: (sy - slope * sx) / n };
  }

  function projectTo(days, key, targetDay) {
    const pts = days.filter(d => !d.future && d[key] != null).slice(-7).map(d => ({ x: d.day, y: d[key] }));
    if (pts.length < 2) return null;
    const { slope, intercept } = linreg(pts);
    return intercept + slope * targetDay;
  }

  let hostEl, gm, model, st, agoTimer, resizeBound;

  function ago(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return s + ' s';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h';
  }

  function weekTarget(key) {
    const w = model.weeks.find(item => item.i === model.cycle.week);
    return w ? w[key] : null;
  }

  function top() {
    const c = model.cycle;
    return `<header class="tb"><div class="logo">GRANA<span>CERTA</span></div><span class="live"><i class="dot"></i>Ao vivo</span><button class="btn js-copy">Copiar resumo</button><button class="btn ic js-theme" aria-label="Alternar tema claro/escuro" title="Alternar tema claro/escuro"><span class="ti"></span></button></header>
<section class="intro"><div class="cyc">Ciclo ${c.n} · Semana ${c.week} de ${c.weeks} · <b>${c.leftLabel}</b></div><div class="obj"><span>Objetivo do ciclo</span><strong>${c.objective}</strong></div></section>`;
  }

  function verdict() {
    const scored = [];
    if (model.users) scored.push(statusOf(model.users.real, model.users.metaToday, false));
    if (model.wait) scored.push(statusOf(model.wait.real, model.wait.metaToday, true));
    if (model.revenue.hasEntries) scored.push(statusOf(model.revenue.real, model.revenue.metaToday, false));
    const known = scored.filter(Boolean);
    let title;
    if (!known.length) title = OFF;
    else {
      const bad = known.filter(s => s === 'bad').length;
      const warn = known.filter(s => s === 'warn').length;
      const worst = bad ? 'bad' : warn ? 'warn' : 'ok';
      const word = worst === 'bad' ? 'Fora do ritmo' : worst === 'warn' ? 'Quase lá' : 'No ritmo';
      title = worst === 'ok'
        ? `<span class="c-ok">No ritmo</span> nas ${known.length} metas de hoje.`
        : `<span class="c-${worst}">${word}</span> em ${bad + warn} de ${known.length} metas hoje.`;
    }
    const gaps = [];
    const uT = weekTarget('usersTarget');
    const wT = weekTarget('waitTarget');
    if (model.users && uT != null && uT > model.users.real) gaps.push(`<b>+${nf(uT - model.users.real)} ativos</b>`);
    if (model.wait && wT != null && model.wait.real > wT) gaps.push(`<b>−${mf(model.wait.real - wT)} min</b> de espera`);
    let sup;
    if (!model.users && !model.wait) sup = OFF;
    else if (!gaps.length) sup = 'As metas da semana que estão conectadas já foram cobertas.';
    else sup = `Para fechar a semana na meta: ${gaps.join(' e ')} até ${model.today.weekEndLabel}.`;

    return `<section class="vd" data-screen-label="Veredito do dia"><span class="eye">Hoje · ${model.today.label}</span><h2>${title}</h2><p class="sup">${sup}</p>
<div class="mg">${usersRow()}${waitRow()}${revRow()}</div>${liveCard()}</section>`;
  }

  function usersRow() {
    const u = model.users;
    if (!u) {
      return mrow({ label: `Usuários ativos ${help(G.ativo)}` });
    }
    const s = statusOf(u.real, u.metaToday, false);
    const pct = u.metaToday > 0 ? Math.round(u.real / u.metaToday * 100) : 0;
    const falta = u.metaToday - u.real;
    const main = falta > 0 ? `<b class="c-${s}">faltam ${nf(falta)}</b>` : `<b class="c-ok">meta de hoje batida</b>`;
    const delta = u.delta == null ? '' : `<br>Hoje: ${u.delta >= 0 ? '+' : '−'}${nf(Math.abs(u.delta))} ativos (precisava de +${nf(Math.max(0, u.neededToday))})`;
    return mrow({
      status: s,
      label: `Usuários ativos ${help(G.ativo)}`,
      num: nf(u.real),
      main,
      sub: `<span>meta até hoje: ${nf(u.metaToday)} ${help(G.metaHoje)}</span>`,
      bar: u.metaToday > 0 ? u.real / u.metaToday * 100 : 0,
      extra: `${pct}% da meta até hoje${delta}<br>Meta da semana: ${nf(weekTarget('usersTarget'))} ${help(G.metaSem)}`,
    });
  }

  function waitRow() {
    const w = model.wait;
    if (!w) return mrow({ label: 'Tempo médio de espera' });
    const s = statusOf(w.real, w.metaToday, true);
    const diff = w.real - w.metaToday;
    const main = diff > 0.005
      ? `<b class="c-${s}">${mf(diff)} min acima da meta</b>`
      : `<b class="c-ok">${mf(Math.abs(diff))} min dentro da meta</b>`;
    return mrow({
      status: s,
      label: `Tempo médio de espera ${help(G.tempo)}`,
      num: `${mf(w.real)}<small>min</small>`,
      main,
      sub: `<span>meta até hoje: ${mf(w.metaToday)} min</span>`,
      bar: w.real > 0 ? w.metaToday / w.real * 100 : 0,
      extra: `Meta da semana: ${mf(weekTarget('waitTarget'))} min`,
      note: 'menor é melhor',
    });
  }

  function revRow() {
    const r = model.revenue;
    const target = weekTarget('revTarget');
    if (!r.hasEntries) {
      return mrow({
        status: 'wait',
        label: 'Receita',
        num: 'R$ 0',
        sub: '<span class="wt">Começa a contar quando o paywall for ligado.</span>',
        extra: `Meta da semana: ${money(target || 0)}`,
      });
    }
    const s = statusOf(r.real, r.metaToday, false) || 'wait';
    const pct = r.metaToday > 0 ? Math.round(r.real / r.metaToday * 100) : 0;
    return mrow({
      status: s,
      label: 'Receita',
      num: money(r.real),
      main: r.metaToday > r.real ? `<b class="c-${s}">faltam ${money(r.metaToday - r.real)}</b>` : '<b class="c-ok">meta de hoje batida</b>',
      sub: `<span>meta até hoje: ${money(r.metaToday)}</span>`,
      bar: r.metaToday > 0 ? r.real / r.metaToday * 100 : 0,
      extra: `${pct}% da meta até hoje<br>Meta da semana: ${money(target || 0)}`,
    });
  }

  function mrow(o) {
    const off = o.num == null;
    const bar = o.bar == null || off ? '' : `<div class="bar"><i style="width:${Math.max(0, Math.min(100, o.bar))}%"></i></div>`;
    const extra = off || !o.extra ? '' : `<div class="mr-x">${o.extra}</div>`;
    const right = off ? '' : `<span class="mr-r">${o.main || ''}${o.sub || ''}${o.note ? `<span class="nt">${o.note}</span>` : ''}</span>`;
    return `<div class="mr ${o.status ? 's-' + o.status : ''}" role="button" tabindex="0" aria-expanded="false"><div class="mr-h"><span class="lb">${o.label}</span>${o.status ? pill(o.status) : ''}<span class="chev"></span></div><div class="mr-b">${off ? '<span class="big nc">sem conexão</span>' : `<span class="big">${o.num}</span>`}${right}</div>${bar}${extra}</div>`;
  }

  function liveCard() {
    const live = model.running;
    let value = '<span class="big nc">sem conexão</span>';
    let cmp = '';
    if (live) {
      value = `<span class="big">${nf(live.now)}</span>`;
      if (live.delta == null) cmp = '';
      else if (live.delta === 0) cmp = '<span class="flat">igual ao mesmo horário ontem</span>';
      else {
        const cls = live.delta > 0 ? '' : ' class="down"';
        const sign = live.delta > 0 ? '+' : '−';
        cmp = `<span${cls}>${sign}${nf(Math.abs(live.delta))} vs. o mesmo horário ontem</span>`;
      }
    }
    const when = live && model.receivedAt ? `ao vivo · atualizado há <span class="js-ago">${ago(model.receivedAt)}</span>` : OFF;
    return `<aside class="lc"><div class="lc-l"><span class="lb">Rodando agora ${help(G.rodando)}</span><p>entregadores ativos nos últimos 15 min</p><span class="ind"><i class="dot"></i>${when}</span></div><div class="lc-r">${value}${cmp}</div></aside>`;
  }

  function periodBar() {
    const keys = ['hoje', 'ontem', 'semana', 'passada', 'custom'];
    const labels = { hoje: 'Hoje', ontem: 'Ontem', semana: 'Esta semana', passada: 'Semana passada', custom: 'Personalizado' };
    const cur = model.periods[st.period] || model.periods.hoje;
    const cus = st.period === 'custom' ? ' on' : '';
    return `<div class="pd"><div class="pd-t"><b>Período</b><span class="js-cmpl">${cur.cmp}</span></div><div class="seg">${keys.map(k => `<button data-p="${k}" class="${k === st.period ? 'on' : ''}">${labels[k]}</button>`).join('')}</div><div class="cus${cus}"><input class="inp js-p0" type="date" value="${st.p0}" aria-label="De"><input class="inp js-p1" type="date" value="${st.p1}" aria-label="Até"><button class="btn pri js-papply">Aplicar</button></div></div>`;
  }

  function deltaLine(n) {
    if (n === 0) return 'igual ao período anterior';
    return (n > 0 ? '+' : '−') + nf(Math.abs(n)) + ' vs. período anterior';
  }

  function base() {
    const p = model.periods[st.period] || model.periods.hoje;
    const active = p.active;
    const prev = p.prev;
    const linked = p.added != null && p.retained != null && p.lost != null;
    let say = '';
    if (active == null) say = `<p class="say">${OFF}</p>`;
    else if (prev != null) {
      const d = linked ? p.added - p.lost : active - prev;
      say = d > 0
        ? `<p class="say">A base cresceu <b class="c-ok">+${nf(d)}</b> ativos.</p>`
        : d < 0
          ? `<p class="say">A base caiu <b class="c-bad">−${nf(-d)}</b> ativos.</p>`
          : '<p class="say">A base ficou estável.</p>';
    }
    const li = (lb, tip, value, sub) => `<div class="li"><div><span class="lb">${lb} ${help(tip)}</span><p>${sub}</p></div>${value}</div>`;
    const ativoSub = active != null && prev != null ? deltaLine(active - prev) : p.lbl;
    const retSub = !linked ? OFF : (prev > 0 ? Math.round(p.retained / prev * 100) + '% dos ativos anteriores continuaram' : 'ninguém no período anterior');
    const eq = linked
      ? `<b>${nf(prev)}</b> no período anterior − <b>${nf(p.lost)}</b> perdidos + <b>${nf(p.added)}</b> novos = <b>${nf(active)}</b> agora`
      : OFF;
    return `<section class="sec" data-screen-label="Base de usuários"><div class="sh"><h3>Base de usuários</h3><p class="ss">Quem chegou, quem ficou e quem saiu · ${p.lbl} vs. ${p.vs}</p>${say}</div><div class="ls">
${li('Ativos', G.ativoPeriodo, big(active, active == null ? '' : nf(active)), ativoSub)}
${li('Novos', G.novo, big(linked ? p.added : null, linked ? nf(p.added) : ''), linked ? 'não estavam ativos no período anterior' : OFF)}
${li('Retidos', G.retido, big(linked ? p.retained : null, linked ? nf(p.retained) : ''), retSub)}
${li('Perdidos', G.perdido, big(linked ? p.lost : null, linked ? nf(p.lost) : ''), linked ? 'estavam ativos e pararam' : OFF)}
</div><div class="eq">${eq}</div></section>`;
  }

  function funnel() {
    const p = model.periods[st.period] || model.periods.hoje;
    const fun = p.funnel;
    let say = OFF;
    let stages = '';
    let callout = '';
    if (!fun) {
      stages = FS.map((item, i) => `<div class="st"><div class="st-h"><span class="ix">${i + 1}</span><span class="nm">${item[0]} ${help(item[1])}</span><span class="v nc">${OFF}</span></div></div>`).join('');
    } else if (fun.login === 0) {
      say = 'Nenhum login novo neste período.';
      stages = FS.map((item, i) => `<div class="st"><div class="st-h"><span class="ix">${i + 1}</span><span class="nm">${item[0]} ${help(item[1])}</span><span class="v">0</span></div><div class="st-b"></div></div>`).join('');
    } else {
      const steps = [fun.login, fun.accessibility, fun.active];
      const drops = [
        { from: 0, to: 1, lost: steps[0] - steps[1] },
        { from: 1, to: 2, lost: steps[1] - steps[2] },
      ];
      const worst = drops.reduce((a, b) => (b.lost > a.lost ? b : a));
      const pct = (Math.round(fun.active / fun.login * 1000) / 10).toFixed(1).replace('.', ',');
      say = `<b>${nf(fun.active)}</b> de <b>${nf(fun.login)}</b> novos logins viraram ativos (${pct}%).`;
      stages = FS.map((item, i) => {
        const value = steps[i];
        const width = Math.max(0, Math.min(100, value / fun.login * 100));
        const bar = value > 0 ? `<div class="st-b"><i style="width:${width}%"></i></div>` : '<div class="st-b"></div>';
        const bridge = i === 0 ? '' : (() => {
          const drop = drops[i - 1];
          if (drop.lost <= 0) return '<div class="cn"><span>todos seguiram</span></div>';
          const mark = drop === worst ? ' mx' : '';
          const tag = drop === worst ? '<span class="ls2">pararam aqui</span>' : '';
          return `<div class="cn${mark}"><span>${nf(drop.lost)} não seguiram</span>${tag}</div>`;
        })();
        return `${bridge}<div class="st"><div class="st-h"><span class="ix">${i + 1}</span><span class="nm">${item[0]} ${help(item[1])}</span><span class="v">${nf(value)}</span></div>${bar}</div>`;
      }).join('');
      if (worst.lost > 0) {
        callout = `<div class="callout"><i class="dot"></i><span>A maior perda foi entre ${esc(FS[worst.from][0])} e ${esc(FS[worst.to][0])}: ${nf(worst.lost)} pararam.</span></div>`;
      }
    }
    return `<section class="sec" data-screen-label="Funil de aquisição"><div class="sh"><h3>Funil de aquisição</h3><p class="ss">Do primeiro login até virar ativo · ${p.lbl}</p><p class="say">${say}</p></div><div class="fn">${stages}</div>${callout}</section>`;
  }

  function storeTable(rows) {
    if (rows == null) return `<div class="empty">${OFF}</div>`;
    if (!rows.length) return '<div class="empty">Ainda não há coletas suficientes neste período.</div>';
    const head = '<div class="tr th"><span>#</span><span>Loja · Cidade</span><span class="r">Espera média</span><span class="r">Coletas</span></div>';
    const body = rows.map((row, i) => {
      const city = row.city ? `<span class="ct">${esc(row.city)}</span>` : '';
      return `<div class="tr"><span class="rk">${i + 1}</span><span>${esc(row.name)}${city}</span><span class="r w">${pf(row.avg_min)} min</span><span class="r">${nf(row.pickups)}</span></div>`;
    }).join('');
    return head + body;
  }

  function cityTable(rows, base) {
    if (rows == null) return `<div class="empty">${OFF}</div>`;
    if (!rows.length) return '<div class="empty">Ainda não há ativos com cidade neste período.</div>';
    const head = '<div class="tr th cy"><span>#</span><span>Cidade</span><span>UF</span><span class="r">Ativos</span><span class="r">% da base</span></div>';
    const body = rows.map((row, i) => {
      const share = base > 0 ? Number(row.active) / base * 100 : 0;
      return `<div class="tr cy"><span class="rk">${i + 1}</span><span>${esc(row.name)}</span><span>${esc(row.uf)}</span><span class="r">${nf(row.active)}</span><span class="r">${pp(share)}%</span></div>`;
    }).join('');
    const slice = rows.reduce((sum, row) => sum + Number(row.active || 0), 0);
    const foot = base > 0 ? pp(slice / base * 100) : pp(0);
    const label = rows.length === 5 ? 'As cinco' : 'Soma';
    return head + body + `<div class="tr cy"><span></span><span>${label}</span><span></span><span class="r">${nf(slice)}</span><span class="r">${foot}%</span></div>`;
  }

  function ops() {
    const p = model.periods[st.period] || model.periods.hoje;
    const cover = (lb, current, previous) => {
      const sub = current == null || previous == null ? OFF : deltaLine(current - previous);
      return `<div class="li"><div><span class="lb">${lb}</span><p>${sub}</p></div>${big(current, current == null ? '' : nf(current))}</div>`;
    };
    return `<section class="sec" data-screen-label="Operação"><div class="sh"><h3>Operação</h3></div><div class="ls">
${cover('Lojas cadastradas', p.storesNew, p.storesPrev)}
${cover('Cidades', p.citiesNew, p.citiesPrev)}
${cover('Estados', p.statesNew, p.statesPrev)}
</div><div class="opsb"><div class="sb"><h4>Onde mais se espera</h4><p class="ss">Lojas com maior tempo médio de espera · ${p.lbl}</p>${storeTable(p.topStores)}</div>
<div class="sb"><h4>Onde estão os usuários</h4><p class="ss">Cidades com mais usuários ativos · ${p.lbl}</p>${cityTable(p.topCities, p.active)}</div></div></section>`;
  }

  function cell(i, real, meta, fm, name, lower, revenue) {
    const now = i === model.cycle.week;
    const nw = now ? ' now' : '';
    if (i > model.cycle.week) {
      return `<div class="wc k-fut${nw}" title="S${i} · ${name}: meta ${fm(meta)} · Futura"><b>${fm(meta)}</b></div>`;
    }
    if (revenue && !model.revenue.hasEntries) {
      return `<div class="wc k-wait${nw}" title="S${i} · ${name}: — · Aguardando"><b>—</b><span>meta ${fm(meta)}</span></div>`;
    }
    if (real == null) {
      return `<div class="wc k-wait${nw}" title="S${i} · ${name}: ${OFF}"><b class="nc">${OFF}</b><span>meta ${fm(meta)}</span></div>`;
    }
    const goal = now ? (lower ? model.pace.wait : revenue ? model.pace.rev : model.pace.users) : meta;
    const s = statusOf(real, goal, lower) || 'wait';
    const word = now ? SL[s] : KW[s];
    const shown = lower ? Math.round((goal / real) * 100) : Math.round((real / (goal || 1)) * 100);
    return `<div class="wc k-${s}${nw}" title="S${i} · ${name}: ${fm(real)} de ${fm(meta)} (${shown}%) · ${word}"><b>${fm(real)}</b><span>meta ${fm(meta)}</span></div>`;
  }

  function goals() {
    const weeks = model.weeks;
    const week = model.cycle.week;
    const end = weeks[weeks.length - 1];
    const cur = weeks.find(w => w.i === week);
    const usersNow = model.users ? model.users.real : null;
    const waitNow = model.wait ? model.wait.real : null;
    const revNow = model.revenue.hasEntries ? model.revenue.real : null;
    const bar = (label, width, text) => `<div><span class="lb">${label}</span><div class="bar"><i style="width:${Math.max(0, Math.min(100, width))}%"></i></div><p>${text}</p></div>`;
    const uText = usersNow == null ? OFF : `${nf(usersNow)} de ${nf(end.usersTarget)} · ${Math.round(usersNow / end.usersTarget * 100)}%`;
    const rPct = !model.revenue.hasEntries || !end.revTarget ? 0 : revNow / end.revTarget * 100;
    const rPctLabel = rPct > 0 && rPct < 1 ? '<1%' : Math.round(rPct) + '%';
    const rText = !model.revenue.hasEntries
      ? `${money(0)} de ${money(end.revTarget)} · aguardando paywall`
      : `${money(revNow)} de ${money(end.revTarget)} · ${rPctLabel}`;
    let tText = OFF;
    let tWidth = 0;
    if (waitNow != null) {
      const start = weeks[0].waitTarget;
      const goal = end.waitTarget;
      const span = start - goal;
      const walked = span ? (start - waitNow) / span * 100 : 0;
      tWidth = walked;
      tText = `${mf(waitNow)} min → meta ${mf(goal)} min · começou em ${mf(start)} min (${Math.round(walked)}% do caminho)`;
    }
    const rows = weeks.map(w => {
      const realU = w.i === week ? usersNow : w.users;
      const realW = w.i === week ? waitNow : w.wait;
      const realR = w.i === week ? revNow : w.rev;
      const tag = w.i < week ? 'Concluída' : w.i === week ? 'Agora' : 'Futura';
      const tip = w.i === 0 ? ' ' + help('Semana 0: aquecimento antes do ciclo') : '';
      return `<div class="wr ${w.i === week ? 'now' : ''}"><div class="wn"><b>S${w.i}${tip}</b><span>${w.range}</span><em>${tag}</em></div>${cell(w.i, realU, w.usersTarget, nf, 'Usuários ativos', false, false)}${cell(w.i, realR, w.revTarget, money, 'Receita', false, true)}${cell(w.i, realW, w.waitTarget, mf, 'Tempo de espera', true, false)}</div>`;
    }).join('');
    const head = weeks.map(w => {
      const tag = w.i < week ? 'Concluída' : w.i === week ? 'Agora' : 'Futura';
      const tip = w.i === 0 ? ' ' + help('Semana 0: aquecimento antes do ciclo') : '';
      return `<div class="wn ${w.i === week ? 'now' : ''}"><b>S${w.i}${tip}</b><span>${w.range}</span><em>${tag}</em></div>`;
    }).join('');
    const line = (name, pick, fm, lower, revenue) => `<div class="hr"><span class="rl">${name}</span>${weeks.map(w => cell(w.i, pick(w), revenue ? w.revTarget : lower ? w.waitTarget : w.usersTarget, fm, name, lower, revenue)).join('')}</div>`;
    return `<section class="sec" data-screen-label="Metas do ciclo"><div class="sh"><h3>Metas do ciclo ${model.cycle.n}</h3><p class="ss">12 semanas, 3 metas · Semana ${week} de 12</p></div>
<div class="gp">${bar('Usuários ativos', usersNow == null || !end.usersTarget ? 0 : usersNow / end.usersTarget * 100, uText)}${bar('Receita acumulada', rPct, rText)}${bar('Tempo médio de espera', tWidth, tText)}</div>
<div class="wkh"><div class="hr"><span></span>${head}</div>${line('Usuários ativos', w => w.i === week ? usersNow : w.users, nf, false, false)}${line('Receita', w => w.i === week ? revNow : w.rev, money, false, true)}${line('Tempo de espera', w => w.i === week ? waitNow : w.wait, mf, true, false)}</div>
<div class="wk"><div class="wr hd"><span></span><span>Usuários ativos</span><span>Receita</span><span>Tempo de espera</span></div>${rows}</div>
<div class="lg"><span><i class="k-ok"></i>Bateu</span><span><i class="k-warn"></i>Quase (90% a 99%)</span><span><i class="k-bad"></i>Não bateu</span><span><i class="k-fut"></i>Futura</span><span>Tempo: menor é melhor</span></div>
<p class="sum">${goalsSummary(cur)}</p></section>`;
  }

  function goalsSummary() {
    const week = model.cycle.week;
    const done = model.weeks.filter(w => w.i <= week).map(w => ({
      i: w.i,
      users: w.i === week ? (model.users ? model.users.real : null) : w.users,
      target: w.usersTarget,
    })).filter(w => w.users != null && w.target);
    if (!done.length) return OFF;
    const hit = done.filter(w => w.users >= w.target);
    let best = done[0];
    done.forEach(w => { if (w.users / w.target > best.users / best.target) best = w; });
    const opened = week === 0 ? 'Na semana 0' : `Em ${week} ${week === 1 ? 'semana' : 'semanas'}`;
    const hitTxt = hit.length
      ? `A meta de usuários foi batida em ${hit.length === 1 ? '1 semana' : hit.length + ' semanas'}.`
      : `${opened}, a meta de usuários ainda não foi batida.`;
    return `${hitTxt} Melhor semana até agora: S${best.i}, com ${nf(best.users)} ativos (${Math.round(best.users / best.target * 100)}% da meta).`;
  }

  function evo() {
    const tabs = [['users', 'Usuários ativos'], ['rev', 'Receita'], ['time', 'Tempo de espera']];
    const chips = [['7', '7 dias'], ['14', '14 dias'], ['ciclo', 'Ciclo todo'], ['custom', 'Personalizado']];
    return `<section class="sec js-evo" data-screen-label="Evolução"><div class="eh"><h3 class="cd" style="margin:0;font-size:30px;line-height:1">Evolução</h3><button class="btn pri js-open">+ Lançar receita</button></div>
<div class="ectl"><div class="tabs">${tabs.map(([k, v]) => `<button data-t="${k}" class="${k === st.tab ? 'on' : ''}">${v}</button>`).join('')}</div>
<div class="chips">${chips.map(([k, v]) => `<button data-r="${k}" class="${k === st.range ? 'on' : ''}">${v}</button>`).join('')}</div></div>
<div class="evo-cus${st.range === 'custom' ? ' on' : ''}"><input class="inp js-c0" type="date" value="${st.c0}" aria-label="De"><input class="inp js-c1" type="date" value="${st.c1}" aria-label="Até"><button class="btn pri js-capply">Aplicar</button></div>
<p class="esay js-say"></p><div class="elg"><span><i></i>Real</span><span><i class="m"></i>Meta</span><span><i class="p"></i>Projeção ${help('Para onde o número vai se o ritmo dos últimos 7 dias continuar.')}</span></div><div class="chart js-chart"></div></section>`;
  }

  function foot() {
    const when = model.updatedLabel ? `Última atualização às ${model.updatedLabel}.` : OFF;
    return `<div class="foot"><div class="about"><h1>Construindo o <em>Grana Certa.</em></h1><p class="sub">Painel aberto do app que mostra o tempo de espera nas lojas do iFood para entregadores. Metas, números e tropeços, semana a semana.</p></div>${when}</div>`;
  }

  function sheet() {
    return `<div class="ov js-ov"><div class="sheet" role="dialog" aria-modal="true" aria-label="Lançar receita"><span class="grab"></span><h4>Lançar receita</h4><label class="fld">Data<input class="inp js-date" type="date" value="${model.today.iso}"></label><label class="fld">Valor (R$)<input class="inp js-val" inputmode="decimal" placeholder="0,00"></label><label class="fld">Origem<input class="inp js-origin" placeholder="ex.: assinatura mensal"></label><div class="err js-err">Digite um valor maior que zero.</div><div class="sb2"><button class="btn js-cancel">Cancelar</button><button class="btn pri js-save">Salvar</button></div></div></div><div class="toast js-toast"></div>`;
  }

  function series(tab, range) {
    const spec = tab === 'users'
      ? { key: 'users', meta: 'usersMeta', unit: 'ativos', f: nf }
      : tab === 'time'
        ? { key: 'wait', meta: 'waitMeta', unit: 'min', f: mf }
        : { key: 'rev', meta: 'revMeta', unit: 'R$', f: v => money(v) };
    if (range === 'ciclo') {
      const weeks = model.weeks;
      const real = weeks.map(w => w.i > model.cycle.week ? null : (spec.key === 'users' ? (w.i === model.cycle.week ? (model.users && model.users.real) : w.users) : spec.key === 'wait' ? (w.i === model.cycle.week ? (model.wait && model.wait.real) : w.wait) : (w.i === model.cycle.week ? (model.revenue.hasEntries ? model.revenue.real : null) : w.rev)));
      const meta = weeks.map(w => spec.key === 'users' ? w.usersTarget : spec.key === 'wait' ? w.waitTarget : w.revTarget);
      return { lab: weeks.map(w => 'S' + w.i), real, meta, today: model.cycle.week, unit: spec.unit, f: spec.f, connected: real.some(v => v != null) };
    }
    let days = range === 'custom' && st.customDays ? st.customDays : model.days;
    if (!days || !days.length) return { lab: [], real: [], meta: [], today: -1, unit: spec.unit, f: spec.f, connected: false };
    const todayIdx = days.findIndex(d => d.day === model.today.day);
    if ((range === '7' || range === '14') && todayIdx >= 0) {
      const n = range === '7' ? 7 : 14;
      days = days.slice(Math.max(0, todayIdx - n + 1));
    }
    const todayAt = days.findIndex(d => d.day === model.today.day);
    const real = days.map(d => (d.future ? null : d[spec.key]));
    const meta = days.map(d => d[spec.meta]);
    return { lab: days.map(d => d.label), real, meta, today: todayAt, unit: spec.unit, f: spec.f, connected: real.some(v => v != null) };
  }

  function addProj(real) {
    let last = -1;
    const pts = [];
    real.forEach((v, i) => { if (v != null) { last = i; pts.push({ x: i, y: v }); } });
    const proj = real.map(() => null);
    const use = pts.slice(-7);
    if (use.length < 2 || last < 0) return proj;
    const { slope, intercept } = linreg(use);
    proj[last] = real[last];
    for (let i = last + 1; i < real.length; i++) proj[i] = Math.max(0, intercept + slope * i);
    return proj;
  }

  function draw(el, tab, range) {
    const s = series(tab, range);
    if (!s.lab.length || !s.connected) {
      el.innerHTML = `<div class="chart-empty">${OFF}</div>`;
      return s;
    }
    const W = Math.max(280, el.clientWidth - 16);
    const H = el.clientWidth > 700 ? 320 : 240;
    const pl = 44, pr = el.clientWidth > 700 ? 44 : 30, pt = 26, pb = 26;
    const proj = addProj(s.real);
    const n = s.lab.length;
    const nums = [...s.real, ...s.meta, ...proj].filter(v => v != null && isFinite(v));
    let max = Math.max(1, ...nums) * 1.08;
    const mag = Math.pow(10, Math.floor(Math.log10(max || 1)));
    max = Math.ceil(max / (mag / 2)) * (mag / 2) || 1;
    const x = i => pl + (n === 1 ? (W - pl - pr) / 2 : i * (W - pl - pr) / (n - 1));
    const y = v => pt + (1 - v / max) * (H - pt - pb);
    const path = a => {
      let d = '', on = false;
      a.forEach((v, i) => {
        if (v == null || !isFinite(v)) { on = false; return; }
        d += (on ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
        on = true;
      });
      return d;
    };
    let g = '';
    for (let k = 0; k <= 4; k++) {
      const v = max * k / 4;
      const yy = y(v);
      const tick = tab === 'time' ? v.toFixed(1).replace('.', ',') : nf(v);
      g += `<line class="ax" x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}"></line><text x="${pl - 6}" y="${yy + 4}" text-anchor="end">${tick}</text>`;
    }
    const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((W - pl - pr) / 46))));
    const markToday = s.today >= 0 && s.today < n;
    let xl = '';
    s.lab.forEach((l, i) => {
      if ((i % step === 0 && Math.abs(i - s.today) >= step) || (markToday && i === s.today)) {
        xl += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" ${markToday && i === s.today ? 'class="tdl"' : ''}>${l}</text>`;
      }
    });
    const tx = x(markToday ? s.today : 0);
    let li = -1;
    s.real.forEach((v, i) => { if (v != null) li = i; });
    const dots = s.real.map((v, i) => v == null ? '' : `<circle class="dt" cx="${x(i)}" cy="${y(v)}" r="${i === li ? 4.5 : 2.5}"></circle>`).join('');
    const label = li >= 0 ? `<text class="vl" x="${x(li) - 6}" y="${y(s.real[li]) - 10}" text-anchor="end">${s.f(s.real[li])}</text>` : '';
    const todayLine = markToday ? `<line class="td" x1="${tx}" x2="${tx}" y1="${pt - 6}" y2="${H - pb}"></line><text class="tdl" x="${tx}" y="${pt - 10}" text-anchor="middle">Hoje</text>` : '';
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Evolução">${g}<text x="${pl - 6}" y="12" text-anchor="end">${s.unit}</text>${todayLine}<path class="lm" d="${path(s.meta)}"></path><path class="lp" d="${path(proj)}"></path><path class="lr" d="${path(s.real)}"></path>${dots}${label}${xl}</svg>`;
    return s;
  }

  function sayText(tab, drawn) {
    if (tab === 'time') return '';
    if (tab === 'rev' && !model.revenue.hasEntries) return 'A receita entra na conta quando o paywall for ligado.';
    if (tab === 'rev') {
      const end = model.revenue.hasEntries ? projectTo(model.days, 'rev', model.today.weekEndDay) : null;
      if (end == null) return '';
      return `No ritmo atual, a semana fecha com cerca de <b>${money(Math.max(0, end))}</b>. Meta: ${money(weekTarget('revTarget') || 0)}.`;
    }
    if (!model.users) return OFF;
    const end = projectTo(model.days, 'users', model.today.weekEndDay);
    if (end == null) return drawn && drawn.connected ? '' : OFF;
    return `No ritmo atual, a semana fecha com cerca de <b>${nf(Math.max(0, end))}</b> ativos. Meta: ${nf(weekTarget('usersTarget') || 0)}.`;
  }

  function chart() {
    if (!gm) return;
    const el = gm.querySelector('.js-chart');
    const say = gm.querySelector('.js-say');
    if (!el || !say) return;
    if (st.tab === 'rev' && !model.revenue.hasEntries) {
      el.innerHTML = '<div class="chart-empty">Aguardando o paywall.</div>';
      say.innerHTML = 'A receita entra na conta quando o paywall for ligado.';
      say.style.display = '';
      gm.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === st.tab));
      gm.querySelectorAll('[data-r]').forEach(b => b.classList.toggle('on', b.dataset.r === st.range));
      const waitingCus = gm.querySelector('.evo-cus');
      if (waitingCus) waitingCus.classList.toggle('on', st.range === 'custom');
      return;
    }
    const drawn = draw(el, st.tab, st.range);
    const text = sayText(st.tab, drawn);
    say.innerHTML = text;
    say.style.display = text ? '' : 'none';
    gm.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === st.tab));
    gm.querySelectorAll('[data-r]').forEach(b => b.classList.toggle('on', b.dataset.r === st.range));
    const cus = gm.querySelector('.evo-cus');
    if (cus) cus.classList.toggle('on', st.range === 'custom');
  }

  function paintScoped() {
    const slot = gm.querySelector('.js-scoped');
    if (!slot) return;
    slot.innerHTML = periodBar() + base() + funnel() + ops();
  }

  function paint() {
    if (!gm) return;
    if (gm.querySelector('.js-ov.on')) { st.dirty = true; return; }
    gm.dataset.theme = st.theme;
    gm.classList.toggle('emb', !!model.embedded);
    gm.innerHTML = `<div class="in">${top()}${verdict()}<div class="js-scoped"></div>${goals()}${evo()}${foot()}</div>${sheet()}`;
    paintScoped();
    chart();
    requestAnimationFrame(() => chart());
    const agoEl = gm.querySelector('.js-ago');
    if (agoEl && model.receivedAt) agoEl.textContent = ago(model.receivedAt);
  }

  function baseLine(p) {
    if (!p || p.added == null) {
      return `Base: ${p && p.active != null ? nf(p.active) + ' ativos' : OFF} · novos, retidos e perdidos ${OFF}`;
    }
    return `Base: ${nf(p.active)} ativos · ${nf(p.added)} novos · ${nf(p.retained)} retidos · ${nf(p.lost)} perdidos`;
  }

  function funnelLine(p) {
    const fun = p && p.funnel;
    if (!fun) return `Funil: ${OFF}`;
    return `Funil: ${nf(fun.login)} logins · ${nf(fun.accessibility)} com acessibilidade · ${nf(fun.active)} viraram ativos`;
  }

  function opsLine(p) {
    if (!p || p.storesNew == null) return `Operação: ${OFF}`;
    const top = p.topStores && p.topStores[0] ? ` · maior espera: ${p.topStores[0].name}` : '';
    return `Operação: ${nf(p.storesNew)} lojas novas · ${nf(p.citiesNew)} cidades novas · ${nf(p.statesNew)} estados novos${top}`;
  }

  function summary() {
    const c = model.cycle;
    const u = model.users;
    const w = model.wait;
    const lines = [
      `Grana Certa · Ciclo ${c.n} · Semana ${c.week}/12 · ${model.today.short}`,
      u ? `Usuários ativos: ${nf(u.real)} (meta até hoje ${nf(u.metaToday)})` : `Usuários ativos: ${OFF}`,
      w ? `Tempo de espera: ${mf(w.real)} min (meta até hoje ${mf(w.metaToday)} min)` : `Tempo de espera: ${OFF}`,
      model.revenue.hasEntries ? `Receita: ${money(model.revenue.real)}` : 'Receita: aguardando paywall',
      model.running ? `Rodando agora: ${nf(model.running.now)} nos últimos 15 min` : `Rodando agora: ${OFF}`,
      baseLine(model.periods[st.period] || model.periods.hoje),
      funnelLine(model.periods[st.period] || model.periods.hoje),
      opsLine(model.periods[st.period] || model.periods.hoje),
    ];
    return lines.join('\n');
  }

  function toast(msg) {
    const t = gm.querySelector('.js-toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(st.toast);
    st.toast = setTimeout(() => t.classList.remove('on'), 2600);
  }

  function readDates(a, b, fallbackA, fallbackB) {
    const s = gm.querySelector(a);
    const e = gm.querySelector(b);
    return [s && s.value ? s.value : fallbackA, e && e.value ? e.value : fallbackB];
  }

  async function onClick(e) {
    const row = e.target.closest('.mr');
    if (row && !e.target.closest('.help')) {
      row.classList.toggle('open');
      row.setAttribute('aria-expanded', row.classList.contains('open'));
      return;
    }
    if (e.target.classList.contains('js-ov')) { closeSheet(); return; }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.p) {
      st.period = b.dataset.p;
      paintScoped();
      return;
    }
    if (b.dataset.t) { st.tab = b.dataset.t; chart(); return; }
    if (b.dataset.r) { st.range = b.dataset.r; chart(); return; }
    if (b.matches('.js-theme')) {
      st.theme = st.theme === 'dark' ? 'light' : 'dark';
      gm.dataset.theme = st.theme;
      document.documentElement.setAttribute('data-theme', st.theme);
      try { localStorage.setItem('gc-theme', st.theme); } catch (_) {}
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', st.theme === 'light' ? '#F4F5EF' : '#0E0F0C');
      return;
    }
    if (b.matches('.js-copy')) {
      const pending = navigator.clipboard && navigator.clipboard.writeText(summary());
      if (pending && pending.catch) pending.catch(() => {});
      b.textContent = 'Resumo copiado';
      setTimeout(() => { if (b.isConnected) b.textContent = 'Copiar resumo'; }, 2000);
      return;
    }
    if (b.matches('.js-open')) {
      gm.querySelector('.js-ov').classList.add('on');
      gm.querySelector('.js-val').value = '';
      gm.querySelector('.js-err').classList.remove('on');
      gm.querySelector('.js-err').textContent = 'Digite um valor maior que zero.';
      return;
    }
    if (b.matches('.js-cancel')) { closeSheet(); return; }
    if (b.matches('.js-papply')) {
      const [a, c] = readDates('.js-p0', '.js-p1', st.p0, st.p1);
      st.p0 = a; st.p1 = c;
      if (!model.loadPeriod) return;
      b.disabled = true;
      try {
        const got = await model.loadPeriod(a, c);
        if (got) model.periods.custom = got;
        st.period = 'custom';
      } finally {
        b.disabled = false;
        paintScoped();
      }
      return;
    }
    if (b.matches('.js-capply')) {
      const [a, c] = readDates('.js-c0', '.js-c1', st.c0, st.c1);
      st.c0 = a; st.c1 = c;
      if (!model.loadDays) return;
      b.disabled = true;
      try { st.customDays = await model.loadDays(a, c); } finally { b.disabled = false; chart(); }
      return;
    }
    if (b.matches('.js-save')) {
      const raw = (gm.querySelector('.js-val').value || '').trim();
      const v = raw.includes(',') ? parseFloat(raw.replace(/\./g, '').replace(',', '.')) : parseFloat(raw);
      const err = gm.querySelector('.js-err');
      if (!(v > 0)) { err.textContent = 'Digite um valor maior que zero.'; err.classList.add('on'); return; }
      const iso = gm.querySelector('.js-date').value;
      const origin = gm.querySelector('.js-origin').value.trim();
      const saved = model.saveRevenue ? model.saveRevenue({ iso, value: v, origin }) : { ok: true };
      if (!saved || saved.ok === false) {
        err.textContent = (saved && saved.error) || 'Não foi possível lançar.';
        err.classList.add('on');
        return;
      }
      st.dirty = false;
      const ov = gm.querySelector('.js-ov');
      if (ov) ov.classList.remove('on');
      if (saved.model) model = saved.model;
      paint();
      const [, mm, dd] = iso.split('-');
      toast(`R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lançado em ${dd}/${mm}.`);
    }
  }

  function closeSheet() {
    const ov = gm.querySelector('.js-ov');
    if (ov) ov.classList.remove('on');
    if (st.dirty) { st.dirty = false; paint(); }
  }

  function onKey(e) {
    const row = e.target.closest('.mr');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); row.click(); }
  }

  function render(host, next) {
    model = next;
    if (!st) {
      const end = model.today.iso;
      const start = model.today.weekAgoIso || end;
      st = { period: 'semana', tab: 'users', range: '7', theme: next.theme || 'dark', p0: start, p1: end, c0: start, c1: end, customDays: null, dirty: false };
    }
    st.theme = next.theme || st.theme;
    hostEl = host;
    if (!gm || gm.parentNode !== host) {
      host.innerHTML = '<div class="gm"></div>';
      gm = host.firstElementChild;
      gm.addEventListener('click', onClick);
      gm.addEventListener('keydown', onKey);
      if (!agoTimer) agoTimer = setInterval(() => {
        const a = gm && gm.querySelector('.js-ago');
        if (a && model && model.receivedAt) a.textContent = ago(model.receivedAt);
      }, 1000);
      if (!resizeBound) {
        resizeBound = true;
        addEventListener('resize', () => chart());
      }
    }
    paint();
    return gm;
  }

  function setModel(next) {
    model = next;
    if (next.periods && next.periods.custom && next.periods.custom.active != null) model.periods.custom = next.periods.custom;
    paint();
  }

  window.GCM = { render, setModel };
})();
