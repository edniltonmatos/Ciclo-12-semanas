# Ciclo 12 Semanas — Grana Certa

Dashboard OKR do Ciclo 4 (04/10 a 26/12 de 2026, 12 semanas). Semana 0: 27/09 a 03/10. Objetivo: conseguir monetizar o app.

## O que o painel mostra

Ao vivo, pela função `get_okr_live_metrics` no projeto TESP:

- Usuários ativos (WAU) e tempo médio de espera no veredito, nas metas e no gráfico
- Rodando agora: contribuidores nos últimos 15 minutos

Pela função `get_okr_period_detail`, no período escolhido (hoje, ontem, esta semana, semana passada ou datas). "Esta semana" compara com os mesmos dias da semana anterior. O SQL está em [supabase/tesp/get_okr_period_detail.sql](supabase/tesp/get_okr_period_detail.sql) e precisa rodar no SQL Editor do TESP:

- Base: ativos, novos, retidos e perdidos. A conta fecha: anterior − perdidos + novos = ativos
- Funil de quem criou a conta no período, em `delivery_profiles`: login, acessibilidade ligada agora e primeira coleta
- Lojas, cidades e estados cuja primeira coleta caiu no período, e a diferença contra o período anterior
- As 10 lojas com maior espera (mínimo de 5 coletas) e as 5 cidades com mais ativos

Enquanto essa função não existir no banco, a base além dos ativos, o funil, a cobertura e os rankings aparecem como **sem conexão**. O veredito continua no WAU dos últimos 7 dias.

A receita vem dos lançamentos feitos neste navegador. Sem lançamento, fica aguardando o paywall. O painel não grava no projeto OKR: a tabela ainda não separa ciclos.

Métrica do TESP: [docs/conectar-tesp.md](docs/conectar-tesp.md)
