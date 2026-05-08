"use strict";

const DATA_PATHS = [
  "data/dashboard-data.json",
  "../data/processed/dashboard-data.json",
  "dashboard-data.json",
];

const state = {
  data: null,
  filteredPasses: [],
  filteredSets: [],
  activeView: "overview",
  passSort: { key: "Profit", direction: "desc" },
  setSort: { key: "robustnessScore", direction: "desc" },
};

const el = {
  dataSummary: document.querySelector("#dataSummary"),
  parameterGuide: document.querySelector("#parameterGuide"),
  monthFilter: document.querySelector("#monthFilter"),
  filterPanel: document.querySelector(".filter-panel"),
  parameterFilterGrid: document.querySelector("#parameterFilterGrid"),
  minProfitFilter: document.querySelector("#minProfitFilter"),
  maxDdFilter: document.querySelector("#maxDdFilter"),
  minPfFilter: document.querySelector("#minPfFilter"),
  minRfFilter: document.querySelector("#minRfFilter"),
  minTradesFilter: document.querySelector("#minTradesFilter"),
  resetFiltersButton: document.querySelector("#resetFiltersButton"),
  tabs: document.querySelectorAll(".tab"),
  views: document.querySelectorAll(".view"),
  kpiGrid: document.querySelector("#kpiGrid"),
  monthSummary: document.querySelector("#monthSummary"),
  monthCountLabel: document.querySelector("#monthCountLabel"),
  histogramLabel: document.querySelector("#histogramLabel"),
  profitHistogram: document.querySelector("#profitHistogram"),
  topCandidatesTable: document.querySelector("#topCandidatesTable"),
  setsTable: document.querySelector("#setsTable"),
  passesTable: document.querySelector("#passesTable"),
  setsCountLabel: document.querySelector("#setsCountLabel"),
  passesCountLabel: document.querySelector("#passesCountLabel"),
  parameterSelect: document.querySelector("#parameterSelect"),
  parameterBars: document.querySelector("#parameterBars"),
  startHeatmap: document.querySelector("#startHeatmap"),
  loadError: document.querySelector("#loadError"),
};

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatNumber(value, digits = 2) {
  return new Intl.NumberFormat("pl-PL", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(number(value));
}

function formatInteger(value) {
  return new Intl.NumberFormat("pl-PL", {
    maximumFractionDigits: 0,
  }).format(number(value));
}

function formatPercent(value, digits = 1) {
  return `${formatNumber(number(value) * 100, digits)}%`;
}

function formatMoney(value) {
  return formatInteger(value);
}

function valueLabel(value) {
  if (value === true) return "true";
  if (value === false) return "false";
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function valueKey(value) {
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") return String(value);
  return valueLabel(value);
}

function formatParameterValue(value, parameterName = "") {
  if (parameterName === "LotyTP2") {
    return number(value) > 0 ? "aktywny" : "nieaktywny";
  }
  if (value === true) return "tak";
  if (value === false) return "nie";
  return valueLabel(value);
}

function formatTableParameterValue(value, parameterName = "", context = null) {
  if (parameterName === "UzyjBreakEvenPoTP1" && context && number(context.LotyTP2) <= 0) {
    return "-";
  }
  if (parameterName === "LotyTP2") {
    return number(value) > 0 ? "tak" : "nie";
  }
  return formatParameterValue(value, parameterName);
}

function metricClass(value) {
  return number(value) >= 0 ? "positive" : "negative";
}

async function loadDashboardData() {
  for (const path of DATA_PATHS) {
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      // Try the next static path.
    }
  }
  throw new Error("No dashboard data file found.");
}

function setupControls() {
  const rerender = () => {
    applyFilters();
    render();
  };

  [
    el.monthFilter,
    el.minProfitFilter,
    el.maxDdFilter,
    el.minPfFilter,
    el.minRfFilter,
    el.minTradesFilter,
  ].forEach((input) => input.addEventListener("input", rerender));

  el.resetFiltersButton.addEventListener("click", () => {
    resetFilters();
    rerender();
  });

  el.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.activeView = tab.dataset.view;
      renderTabs();
    });
  });

  el.parameterSelect.addEventListener("input", () => {
    renderParameterBars();
  });

}

function populateStaticControls() {
  const months = state.data.overall.months || [];
  el.monthFilter.innerHTML = [
    `<option value="">Wszystkie</option>`,
    ...months.map((month) => `<option value="${escapeHtml(month)}">${escapeHtml(month)}</option>`),
  ].join("");

  const parameterOptions = state.data.columns.parameters.map((name) => {
    return `<option value="${escapeHtml(name)}">${escapeHtml(shortSettingName(name))}</option>`;
  });
  el.parameterSelect.innerHTML = parameterOptions.join("");

  el.parameterFilterGrid.innerHTML = state.data.columns.parameters
    .map((name) => {
      const values = uniqueParameterValues(name);
      const tooltip = parameterDescription(name);
      return `
        <label>
          <span title="${escapeHtml(tooltip)}">${escapeHtml(shortSettingName(name))}</span>
          <select data-parameter-filter="${escapeHtml(name)}">
            <option value="">Wszystkie</option>
            ${values
              .map(
                (value) =>
                  `<option value="${escapeHtml(valueKey(value))}">${escapeHtml(formatParameterValue(value, name))}</option>`,
              )
              .join("")}
          </select>
        </label>
      `;
    })
    .join("");

  el.parameterFilterGrid.querySelectorAll("select").forEach((select) => {
    select.addEventListener("input", () => {
      syncDependentParameterFilters();
      applyFilters();
      render();
    });
  });
  syncDependentParameterFilters();
}

function uniqueParameterValues(name) {
  const values = new Map();
  state.data.passes.forEach((row) => {
    const value = row[name];
    values.set(valueKey(value), value);
  });

  return [...values.values()].sort((a, b) => {
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
    return valueLabel(a).localeCompare(valueLabel(b), "pl");
  });
}

function matchesParameterSelects(row) {
  const selects = el.parameterFilterGrid.querySelectorAll("[data-parameter-filter]");
  for (const select of selects) {
    if (select.disabled) continue;
    if (!select.value) continue;
    const parameter = select.dataset.parameterFilter;
    if (valueKey(row[parameter]) !== select.value) return false;
  }
  return true;
}

function getParameterFilter(name) {
  return el.parameterFilterGrid.querySelector(`[data-parameter-filter="${name}"]`);
}

function syncDependentParameterFilters() {
  const tp2Select = getParameterFilter("LotyTP2");
  const breakEvenSelect = getParameterFilter("UzyjBreakEvenPoTP1");
  if (!tp2Select || !breakEvenSelect) return;

  const tp2Inactive = tp2Select.value === "0";
  breakEvenSelect.disabled = tp2Inactive;
  breakEvenSelect.closest("label").classList.toggle("filter-disabled", tp2Inactive);
  if (tp2Inactive) {
    breakEvenSelect.value = "";
  }
}

function resetFilters() {
  el.monthFilter.value = "";
  el.minProfitFilter.value = "";
  el.maxDdFilter.value = "";
  el.minPfFilter.value = "";
  el.minRfFilter.value = "";
  el.minTradesFilter.value = "";
  el.parameterFilterGrid.querySelectorAll("[data-parameter-filter]").forEach((select) => {
    select.value = "";
  });
  syncDependentParameterFilters();
}

function passMatchesFilters(row) {
  const month = el.monthFilter.value;
  const minProfit = el.minProfitFilter.value;
  const maxDd = el.maxDdFilter.value;
  const minPf = el.minPfFilter.value;
  const minRf = el.minRfFilter.value;
  const minTrades = el.minTradesFilter.value;

  if (month && row._month !== month) return false;
  if (minProfit !== "" && number(row.Profit) < number(minProfit)) return false;
  if (maxDd !== "" && number(row["Equity DD %"]) > number(maxDd)) return false;
  if (minPf !== "" && number(row["Profit Factor"]) < number(minPf)) return false;
  if (minRf !== "" && number(row["Recovery Factor"]) < number(minRf)) return false;
  if (minTrades !== "" && number(row.Trades) < number(minTrades)) return false;
  if (!matchesParameterSelects(row)) return false;

  return true;
}

function setMatchesFilteredPasses(setItem, allowedKeys) {
  return allowedKeys.has(setItem.paramKey);
}

function applyFilters() {
  state.filteredPasses = state.data.passes.filter(passMatchesFilters);
  const allowedKeys = new Set(state.filteredPasses.map((row) => row._paramKey));
  state.filteredSets = state.data.parameterSets.filter((item) =>
    setMatchesFilteredPasses(item, allowedKeys),
  );
  sortRows(state.filteredPasses, state.passSort);
  sortRows(state.filteredSets, state.setSort);
}

function render() {
  renderHeader();
  renderParameterGuide();
  renderKpis();
  renderMonthSummary();
  renderHistogram();
  renderTopCandidates();
  renderSetsTable();
  renderPassesTable();
  renderParameterBars();
  renderStartHeatmap();
  renderTabs();
}

function renderHeader() {
  const overall = state.data.overall;
  const reportWord = overall.reportCount === 1 ? "raport" : "raporty";
  const monthsWord = overall.monthCount === 1 ? "miesiąc" : "miesiące";
  el.dataSummary.textContent =
    `${formatInteger(overall.reportCount)} ${reportWord}, ` +
    `${formatInteger(overall.monthCount)} ${monthsWord}, ` +
    `${formatInteger(overall.rowCount)} passów, ` +
    `wygenerowano ${new Date(state.data.generatedAt).toLocaleString("pl-PL")}`;
}

function renderParameterGuide() {
  const settingsFile = state.data.settingsFiles && state.data.settingsFiles[0];
  if (!settingsFile) {
    el.parameterGuide.innerHTML = "";
    return;
  }

  const optimizedCards = settingsFile.optimized
    .map((item) =>
      renderParameterNote(
        shortSettingName(item.name),
        parameterDescription(item.name),
        formatOptimizationOptions(item),
      ),
    )
    .join("");

  const depositCard = renderParameterNote(
    "Startowe saldo konta",
    "Kwota depozytu, od której zaczynał się test optymalizacyjny.",
    initialDepositLabel(),
  );

  const cleanupCard = renderParameterNote(
    "Usuwanie zleceń oczekujących",
    "Moment, w którym robot usuwa niezrealizowane zlecenia oczekujące.",
    pendingCleanupLabel(settingsFile),
  );

  el.parameterGuide.innerHTML = `${optimizedCards}${depositCard}${cleanupCard}`;
}

function renderParameterNote(title, description, value) {
  return `
    <article class="parameter-note compact-note" title="${escapeHtml(description)}" aria-label="${escapeHtml(`${title}: ${description}`)}">
      <h3>${escapeHtml(title)}</h3>
      <p><strong>${escapeHtml(value)}</strong></p>
    </article>
  `;
}

function renderKpis() {
  const rows = state.filteredPasses;
  const profits = rows.map((row) => number(row.Profit));
  const profitable = rows.filter((row) => number(row.Profit) > 0).length;
  const quality = rows.filter((row) => row._quality).length;
  const maxProfit = profits.length ? Math.max(...profits) : 0;
  const medianProfit = median(profits);
  const avgDd = average(rows.map((row) => number(row["Equity DD %"])));
  const bestScore = state.filteredSets.length ? state.filteredSets[0].robustnessScore : 0;

  const kpis = [
    ["Passy", formatInteger(rows.length), "po filtrach"],
    ["Profit dodatni", formatPercent(rows.length ? profitable / rows.length : 0), `${formatInteger(profitable)} passów`],
    ["Mediana profitu", formatMoney(medianProfit), "ważniejsza od piku"],
    ["Max profit", formatMoney(maxProfit), "najlepszy pojedynczy pass"],
    ["Mocne passy", formatInteger(quality), "PF/RF/DD/transakcje"],
    ["Najlepszy score", formatNumber(bestScore, 1), `średni DD ${formatNumber(avgDd, 2)}%`],
  ];

  el.kpiGrid.innerHTML = kpis
    .map(
      ([label, value, note]) => `
        <div class="kpi">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
          <small>${escapeHtml(note)}</small>
        </div>
      `,
    )
    .join("");
}

function renderMonthSummary() {
  const reports = [...state.data.reports].sort((a, b) => number(b.topProfit) - number(a.topProfit));
  const maxTopProfit = Math.max(1, ...reports.map((report) => Math.max(0, number(report.topProfit))));
  el.monthCountLabel.textContent = `${formatInteger(reports.length)} raport`;

  el.monthSummary.innerHTML = reports
    .map((report) => {
      const width = Math.max(3, (Math.max(0, number(report.topProfit)) / maxTopProfit) * 100);
      return `
        <div class="month-row">
          <div class="month-row-head">
            <span>${escapeHtml(report.month || report.sourceFile)}</span>
            <span class="${metricClass(report.topProfit)}">${formatMoney(report.topProfit)}</span>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
          <small>
            mediana ${formatMoney(report.medianProfit)} · jakość ${formatInteger(report.qualityCount)} ·
            DD max ${formatNumber(report.maxEquityDdPct, 2)}%
          </small>
        </div>
      `;
    })
    .join("");
}

function extractDepositCurrency() {
  const deposit = state.data.reports && state.data.reports[0] && state.data.reports[0].deposit;
  if (!deposit) return "";
  const match = String(deposit).match(/[A-Z]{3}$/);
  return match ? match[0] : "";
}

function initialDepositLabel() {
  const deposits = [...new Set((state.data.reports || []).map((report) => report.deposit).filter(Boolean))];
  if (!deposits.length) return "brak danych";
  if (deposits.length === 1) return deposits[0];
  return `różne salda: ${deposits.join(", ")}`;
}

function pendingCleanupLabel(settingsFile) {
  const hours = getSetting(settingsFile, "GodzinPrzedZamknieciemUsunZlecenia");
  const expiry = getSetting(settingsFile, "MinutPrzedZamknieciemWygasniecieZlecen");
  const usesSymbolSession = getSetting(settingsFile, "UzyjSesjiSymboluDoZamknieciaRynku");
  const manualHour = getSetting(settingsFile, "GodzinaZamknieciaRynkuLokalnie");
  const manualMinute = getSetting(settingsFile, "MinutaZamknieciaRynkuLokalnie");
  const hourText = hours ? `${formatSettingValue(hours.current)} godz. przed końcem` : "przed końcem";
  const base = usesSymbolSession && usesSymbolSession.current === true
    ? `${hourText} sesji symbolu`
    : `${hourText} rynku (${padTimePart(manualHour?.current)}:${padTimePart(manualMinute?.current)} lokalnie)`;

  if (!expiry) return base;
  return `${base}; awaryjne wygaśnięcie ${formatSettingValue(expiry.current)} min przed końcem`;
}

function padTimePart(value) {
  return String(number(value)).padStart(2, "0");
}

function getSetting(settingsFile, name) {
  return settingsFile.settings.find((item) => item.name === name);
}

function shortSettingName(name) {
  const labels = {
    UzyjRyzykaKwotowego: "Ryzyko kwotowe",
    RyzykoKwotoweNaZlecenie: "Ryzyko / zlecenie",
    LotyTP1: "Loty TP1",
    LotyTP2: "TP2",
    WartoscPipsa: "Wartość pipsa",
    OdstepWejsciaPipsy: "Odstęp od zakresu w pipsach",
    StopLossPipsy: "Stop Loss",
    TakeProfit1Pipsy: "Take Profit 1",
    TakeProfit2Pipsy: "Take Profit 2",
    UzyjBreakEvenPoTP1: "Break even po TP1",
    BuforBreakEvenPipsy: "Bufor BE",
    GodzinaStartuZakresu: "Godzina startu",
    MinutaStartuZakresu: "Minuta startu",
    GodzinaKoncaZakresu: "Godzina końca",
    MinutaKoncaZakresu: "Minuta końca",
    UzyjSesjiSymboluDoZamknieciaRynku: "Sesja symbolu",
    GodzinPrzedZamknieciemUsunZlecenia: "Usuń oczekujące h",
    MinutPrzedZamknieciemWygasniecieZlecen: "Wygaśnięcie oczekujących min",
    UsunPrzeciwneZleceniePoAktywacji: "Usuń przeciwne zlecenie",
    WymagajWykresuM15: "Wymagaj M15",
    WymagajRachunkuHedging: "Wymagaj hedging",
    BrokerUtcOffsetGodziny: "Broker UTC",
    NumerMagiczny: "Magic number",
  };
  return labels[name] || name;
}

function tableSettingName(name) {
  const labels = {
    LotyTP2: "TP2",
    OdstepWejsciaPipsy: "Odstęp",
    UzyjBreakEvenPoTP1: "BE TP1",
    GodzinaStartuZakresu: "Start h",
    MinutaStartuZakresu: "Start min",
    GodzinaKoncaZakresu: "Koniec h",
    MinutaKoncaZakresu: "Koniec min",
    UsunPrzeciwneZleceniePoAktywacji: "Usuń przeciwne",
  };
  return labels[name] || shortSettingName(name);
}

function parameterDescription(name) {
  const descriptions = {
    UzyjRyzykaKwotowego:
      "Włącza automatyczne liczenie wielkości pozycji z podanej kwoty ryzyka zamiast ręcznego lota.",
    RyzykoKwotoweNaZlecenie:
      "Kwota, którą robot ma ryzykować na jedną część zlecenia, gdy działa tryb ryzyka kwotowego.",
    LotyTP1:
      "Pierwsza część wejścia z bliższym take profitem. W trybie ryzyka kwotowego wartość większa od zera oznacza, że ta część jest włączona.",
    LotyTP2:
      "Druga część wejścia z dalszym take profitem. W tej optymalizacji testowane było, czy ta część ma być wyłączona czy włączona.",
    WartoscPipsa:
      "Przelicznik pipsów na cenę instrumentu. Dla testowanego złota ustawiono 0.1.",
    OdstepWejsciaPipsy:
      "Odległość zleceń Buy Stop i Sell Stop od high/low zmierzonego zakresu.",
    StopLossPipsy:
      "Odległość stop lossa od ceny wejścia. Im większa, tym więcej miejsca ma pozycja, ale rośnie ryzyko ruchu przeciwko nam.",
    TakeProfit1Pipsy:
      "Pierwszy cel zysku dla części TP1. Po jego osiągnięciu TP1 znika z rynku.",
    TakeProfit2Pipsy:
      "Dalszy cel zysku dla części TP2. Ta część ma złapać większy ruch po wybiciu.",
    UzyjBreakEvenPoTP1:
      "Po zamknięciu TP1 robot może przesunąć stop loss TP2 na okolice wejścia, żeby zabezpieczyć drugą część pozycji.",
    BuforBreakEvenPipsy:
      "Mały zapas dodawany do break even, żeby SL TP2 był lekko za ceną wejścia, a nie dokładnie na niej.",
    GodzinaStartuZakresu:
      "Godzina lokalna, od której robot zaczyna mierzyć poranny zakres ceny.",
    MinutaStartuZakresu:
      "Minuta lokalna startu pomiaru zakresu.",
    GodzinaKoncaZakresu:
      "Godzina lokalna końca pomiaru. Po tym czasie robot może wystawić zlecenia oczekujące.",
    MinutaKoncaZakresu:
      "Minuta lokalna końca pomiaru zakresu.",
    UzyjSesjiSymboluDoZamknieciaRynku:
      "Robot pobiera godziny sesji z brokera i według nich pilnuje sprzątania zleceń oczekujących.",
    GodzinaZamknieciaRynkuLokalnie:
      "Ręczna godzina zamknięcia rynku używana awaryjnie, gdy broker nie zwróci sesji symbolu.",
    MinutaZamknieciaRynkuLokalnie:
      "Ręczna minuta zamknięcia rynku używana awaryjnie razem z godziną zamknięcia.",
    GodzinPrzedZamknieciemUsunZlecenia:
      "Ile godzin przed końcem sesji robot ma usunąć swoje niezrealizowane zlecenia oczekujące.",
    MinutPrzedZamknieciemWygasniecieZlecen:
      "Awaryjny czas wygaśnięcia zleceń oczekujących ustawiany u brokera, jeżeli symbol to obsługuje.",
    UsunPrzeciwneZleceniePoAktywacji:
      "Po aktywacji kupna usuwa sprzedaż oczekującą, a po aktywacji sprzedaży usuwa kupno oczekujące.",
    WymagajWykresuM15:
      "Blokuje uruchomienie na innym interwale niż M15. Sam zakres i tak jest liczony ze świec M15.",
    UzyjWygasaniaZlecenOczekujacych:
      "Dodaje brokerowe wygaśnięcie zleceń oczekujących jako zabezpieczenie, gdyby nie było ticka do ręcznego usunięcia.",
    WymagajRachunkuHedging:
      "Wymaga rachunku hedgingowego, bo strategia używa osobnych pozycji TP1 i TP2.",
    HandelPoniedzialek:
      "Pozwala robotowi handlować w poniedziałki.",
    HandelWtorek:
      "Pozwala robotowi handlować we wtorki.",
    HandelSroda:
      "Pozwala robotowi handlować w środy.",
    HandelCzwartek:
      "Pozwala robotowi handlować w czwartki.",
    HandelPiatek:
      "Pozwala robotowi handlować w piątki.",
    UzyjEuropejskiegoCzasuLetniegoLokalnie:
      "Automatycznie uwzględnia zmianę czasu zimowego i letniego w Europie.",
    LokalnyUtcOffsetZimowyGodziny:
      "Lokalny offset UTC zimą, dla Kopenhagi i Polski zwykle +1.",
    LokalnyUtcOffsetLetniGodziny:
      "Lokalny offset UTC latem, dla Kopenhagi i Polski zwykle +2.",
    LokalnyUtcOffsetGodziny:
      "Ręczny offset lokalny używany tylko wtedy, gdy automatyczny czas letni jest wyłączony.",
    BrokerUtcOffsetGodziny:
      "Offset UTC serwera brokera. Robot używa go do przeliczania godzin lokalnych na czas brokera.",
    NumerMagiczny:
      "Unikalny numer strategii. Dzięki niemu robot rozpoznaje swoje zlecenia i pozycje.",
  };
  return descriptions[name] || "Parametr wejściowy EA zapisany w pliku .set.";
}

function formatSettingValue(value) {
  if (value === true) return "tak";
  if (value === false) return "nie";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
  }
  return valueLabel(value);
}

function formatOptimizationOptions(item) {
  if (item.start === null || item.start === undefined) return "zakres z pliku .set";
  const values = optimizationValues(item);
  const formatted = values.map((value) => {
    if (item.name === "LotyTP2") return formatParameterValue(value, item.name);
    return formatSettingValue(value);
  });
  const uniqueValues = [...new Set(formatted)];
  const compactChoice =
    uniqueValues.length <= 2 && (item.name === "LotyTP2" || typeof item.start === "boolean");
  return uniqueValues.join(compactChoice ? " / " : ", ");
}

function optimizationValues(item) {
  if (typeof item.start === "boolean" || typeof item.stop === "boolean") {
    return [item.start, item.stop];
  }

  const start = number(item.start);
  const stop = number(item.stop);
  const step = Math.abs(number(item.step));
  if (!step) return [item.start, item.stop];

  const values = [];
  const direction = start <= stop ? 1 : -1;
  const limit = 100;
  for (let current = start, count = 0; count < limit; current += step * direction, count += 1) {
    const pastStop = direction > 0 ? current > stop + step / 1000 : current < stop - step / 1000;
    if (pastStop) break;
    values.push(Number(current.toFixed(10)));
  }
  return values.length ? values : [item.start, item.stop];
}

function renderHistogram() {
  const canvas = el.profitHistogram;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * scale));
  canvas.height = Math.floor(280 * scale);
  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, rect.width, 280);

  const values = state.filteredPasses.map((row) => number(row.Profit));
  el.histogramLabel.textContent = `${formatInteger(values.length)} passów`;

  if (!values.length) {
    drawEmptyCanvas(ctx, rect.width, 280, "Brak danych po filtrach");
    return;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const binCount = 28;
  const bins = Array.from({ length: binCount }, () => 0);
  const span = max - min || 1;
  values.forEach((value) => {
    const index = Math.min(binCount - 1, Math.floor(((value - min) / span) * binCount));
    bins[index] += 1;
  });

  const padding = { top: 18, right: 14, bottom: 34, left: 42 };
  const width = rect.width - padding.left - padding.right;
  const height = 280 - padding.top - padding.bottom;
  const maxBin = Math.max(...bins, 1);

  ctx.strokeStyle = "#d9e0e4";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + height);
  ctx.lineTo(padding.left + width, padding.top + height);
  ctx.stroke();

  bins.forEach((count, index) => {
    const x = padding.left + (index / binCount) * width;
    const barWidth = width / binCount - 3;
    const barHeight = (count / maxBin) * height;
    const binMid = min + ((index + 0.5) / binCount) * span;
    ctx.fillStyle = binMid >= 0 ? "#1f7a68" : "#b94e48";
    ctx.fillRect(x, padding.top + height - barHeight, Math.max(1, barWidth), barHeight);
  });

  ctx.fillStyle = "#65727d";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText(formatMoney(min), padding.left, 266);
  ctx.textAlign = "right";
  ctx.fillText(formatMoney(max), padding.left + width, 266);
  ctx.textAlign = "left";
}

function drawEmptyCanvas(ctx, width, height, message) {
  ctx.fillStyle = "#65727d";
  ctx.font = "14px system-ui, sans-serif";
  ctx.fillText(message, 18, height / 2);
}

function renderTopCandidates() {
  const rows = state.filteredSets.slice(0, 30);
  el.topCandidatesTable.innerHTML = buildSetsTable(rows, { compact: true });
}

function renderSetsTable() {
  el.setsCountLabel.textContent = `${formatInteger(state.filteredSets.length)} zestawów`;
  el.setsTable.innerHTML = buildSetsTable(state.filteredSets.slice(0, 500), { compact: false });
}

function buildSetsTable(rows, options) {
  const metricColumns = [
    ["rank", "Lp."],
    ["robustnessScore", "Score"],
    ["monthsTested", "Mies."],
    ["profitableMonths", "Profit mies."],
    ["totalProfit", "Suma profit"],
    ["medianMonthlyProfit", "Mediana"],
    ["worstMonthProfit", "Najgorszy"],
    ["avgProfitFactor", "Śr. PF"],
    ["minProfitFactor", "Min PF"],
    ["avgRecoveryFactor", "Śr. RF"],
    ["maxEquityDdPct", "DD%"],
    ["avgTrades", "Trans."],
  ];
  const parameterColumns = state.data.columns.parameters.map((column) => [
    column,
    tableSettingName(column),
  ]);
  const columns = [...metricColumns, ...parameterColumns];

  const tableRows = rows
    .map((row) => {
      return `
        <tr>
          ${columns
            .map(([key]) => {
              const isParameter = state.data.columns.parameters.includes(key);
              const value = isParameter ? row.params[key] : row[key];
              const className = isParameter
                ? "parameter-cell"
                : key.includes("Profit") || key.includes("Monthly")
                  ? metricClass(value)
                  : "";
              const content = formatSetCell(key, value, row.params);
              return `<td class="${className} ${key === "robustnessScore" ? "score-cell" : ""} ${columnClass(key)}">${content}</td>`;
            })
            .join("")}
        </tr>
      `;
    })
    .join("");

  return `
    <table class="data-table">
      ${buildColGroup(columns, "set")}
      <thead>
        <tr>
          ${columns.map(([key, label]) => sortableHeader(label, key, "set")).join("")}
        </tr>
      </thead>
      <tbody>${tableRows || emptyRow(columns.length)}</tbody>
    </table>
  `;
}

function formatSetCell(key, value, context = null) {
  if (state.data.columns.parameters.includes(key)) {
    return escapeHtml(formatTableParameterValue(value, key, context));
  }
  if (key === "rank" || key === "monthsTested" || key === "profitableMonths") return formatInteger(value);
  if (key.includes("Factor")) return formatNumber(value, 3);
  if (key.includes("Trades")) return formatInteger(value);
  if (key.includes("Dd") || key.includes("DD")) return formatNumber(value, 2);
  if (key === "robustnessScore") return formatNumber(value, 1);
  return formatMoney(value);
}

function renderPassesTable() {
  const columns = [
    ["Pass", "Pass"],
    ["_month", "Mies."],
    ["Profit", "Profit"],
    ["Result", "Saldo"],
    ["Profit Factor", "PF"],
    ["Recovery Factor", "RF"],
    ["Sharpe Ratio", "Sharpe"],
    ["Equity DD %", "DD%"],
    ["Trades", "Trans."],
    ...state.data.columns.parameters.map((column) => [column, tableSettingName(column)]),
  ];

  el.passesCountLabel.textContent = `${formatInteger(state.filteredPasses.length)} passów`;
  const rows = state.filteredPasses.slice(0, 700);
  const htmlRows = rows
    .map((row) => {
      return `
        <tr>
          ${columns
            .map(([key]) => {
              const value = row[key];
              const isText = key === "_month" || state.data.columns.parameters.includes(key);
              const className = key === "Profit" ? metricClass(value) : isText ? "text" : "";
              return `<td class="${className} ${columnClass(key)}">${formatPassCell(key, value, row)}</td>`;
            })
            .join("")}
        </tr>
      `;
    })
    .join("");

  el.passesTable.innerHTML = `
    <table class="data-table">
      ${buildColGroup(columns, "pass")}
      <thead>
        <tr>${columns.map(([key, label]) => sortableHeader(label, key, "pass")).join("")}</tr>
      </thead>
      <tbody>${htmlRows || emptyRow(columns.length)}</tbody>
    </table>
  `;
}

function formatPassCell(key, value, context = null) {
  if (key === "_month") return escapeHtml(valueLabel(value));
  if (key === "Pass" || key === "Trades") return formatInteger(value);
  if (["Profit Factor", "Recovery Factor", "Sharpe Ratio"].includes(key)) return formatNumber(value, 3);
  if (key === "Equity DD %") return formatNumber(value, 2);
  if (state.data.columns.parameters.includes(key)) {
    return escapeHtml(formatTableParameterValue(value, key, context));
  }
  return formatMoney(value);
}

function sortableHeader(label, key, type) {
  const sort = type === "set" ? state.setSort : state.passSort;
  const marker = sort.key === key ? (sort.direction === "asc" ? "↑" : "↓") : "";
  const tooltip = headerTooltip(key, label);
  return `
    <th class="${columnClass(key)}" title="${escapeHtml(tooltip)}">
      <button
        type="button"
        data-sort-type="${type}"
        data-sort-key="${escapeHtml(key)}"
        title="${escapeHtml(tooltip)}"
        aria-label="${escapeHtml(`${tooltip}. Kliknij, aby sortować.`)}"
      >${headerLabelHtml(label, marker)}</button>
    </th>
  `;
}

function headerLabelHtml(label, marker) {
  const parts = String(label).trim().split(/\s+/).filter(Boolean);
  const lines =
    parts.length > 1
      ? parts.map((part) => `<span>${escapeHtml(part)}</span>`).join("")
      : `<span>${escapeHtml(parts[0] || label)}</span>`;
  const markerHtml = marker ? `<span class="sort-marker">${escapeHtml(marker)}</span>` : "";
  return `<span class="th-label">${lines}</span>${markerHtml}`;
}

function buildColGroup(columns, type) {
  return `<colgroup>${columns
    .map(([key]) => `<col class="${columnClass(key)}" style="width: ${columnWidth(key, type)};">`)
    .join("")}</colgroup>`;
}

function columnClass(key) {
  return `col-${String(key)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

function columnWidth(key, type) {
  const widths = {
    rank: "3.1%",
    robustnessScore: "4.5%",
    monthsTested: "3.6%",
    profitableMonths: "4.4%",
    totalProfit: "5.1%",
    medianMonthlyProfit: "4.8%",
    worstMonthProfit: "4.9%",
    avgProfitFactor: "4.2%",
    minProfitFactor: "4.2%",
    avgRecoveryFactor: "4.2%",
    maxEquityDdPct: "4.1%",
    avgTrades: "3.9%",
    Pass: "3.7%",
    _month: "5.2%",
    Profit: "4.9%",
    Result: "4.9%",
    "Profit Factor": "4.1%",
    "Recovery Factor": "4.1%",
    "Sharpe Ratio": "4.7%",
    "Equity DD %": "4.1%",
    Trades: "4.1%",
    LotyTP2: "3.4%",
    OdstepWejsciaPipsy: "4.3%",
    UzyjBreakEvenPoTP1: "4.2%",
    GodzinaStartuZakresu: "4.2%",
    MinutaStartuZakresu: "4.3%",
    GodzinaKoncaZakresu: "4.3%",
    MinutaKoncaZakresu: "4.4%",
    UsunPrzeciwneZleceniePoAktywacji: "5.4%",
  };
  return widths[key] || (type === "pass" ? "4.2%" : "4.5%");
}

function headerTooltip(key, label) {
  const tooltips = {
    rank: "Miejsce w rankingu stabilności",
    robustnessScore: "Score stabilności parametrów",
    monthsTested: "Liczba przetestowanych miesięcy",
    profitableMonths: "Liczba miesięcy z dodatnim wynikiem",
    totalProfit: "Suma profitów z miesięcy",
    medianMonthlyProfit: "Mediana miesięcznego profitu",
    worstMonthProfit: "Najgorszy miesięczny profit",
    avgProfitFactor: "Średni Profit Factor",
    minProfitFactor: "Minimalny Profit Factor",
    avgRecoveryFactor: "Średni Recovery Factor",
    maxEquityDdPct: "Maksymalny procentowy drawdown kapitału",
    avgTrades: "Liczba transakcji",
    Pass: "Numer passu z optymalizatora MetaTrader",
    _month: "Miesiąc testu",
    Profit: "Profit",
    Result: "Końcowy stan konta po teście",
    "Profit Factor": "Profit Factor",
    "Recovery Factor": "Recovery Factor",
    "Sharpe Ratio": "Sharpe Ratio",
    "Equity DD %": "Procentowy drawdown kapitału",
    Trades: "Liczba transakcji",
  };

  if (state.data && state.data.columns.parameters.includes(key)) {
    return `${shortSettingName(key)}: ${parameterDescription(key)}`;
  }

  return tooltips[key] || label;
}

function emptyRow(colspan) {
  return `<tr><td colspan="${colspan}" class="text">Brak wyników po filtrach.</td></tr>`;
}

function attachSortHandlers() {
  document.querySelectorAll("[data-sort-key]").forEach((button) => {
    if (button.dataset.sortAttached === "true") return;
    button.dataset.sortAttached = "true";
    button.addEventListener("click", () => {
      const type = button.dataset.sortType;
      const key = button.dataset.sortKey;
      const targetSort = type === "set" ? state.setSort : state.passSort;
      if (targetSort.key === key) {
        targetSort.direction = targetSort.direction === "asc" ? "desc" : "asc";
      } else {
        targetSort.key = key;
        targetSort.direction = state.data.columns.parameters.includes(key) ? "asc" : "desc";
      }
      applyFilters();
      render();
    });
  });
}

function sortRows(rows, sort) {
  rows.sort((a, b) => {
    const av = getSortValue(a, sort.key);
    const bv = getSortValue(b, sort.key);
    let result;
    if (typeof av === "number" && typeof bv === "number") {
      result = av - bv;
    } else {
      result = String(av).localeCompare(String(bv), "pl");
    }
    return sort.direction === "asc" ? result : -result;
  });
}

function getSortValue(row, key) {
  if (row.params && Object.hasOwn(row.params, key)) return row.params[key];
  const value = row[key];
  const asNumber = Number(value);
  return Number.isFinite(asNumber) && value !== "" ? asNumber : valueLabel(value);
}

function renderParameterBars() {
  const parameter = el.parameterSelect.value || state.data.columns.parameters[0];
  if (!parameter) {
    el.parameterBars.innerHTML = "";
    return;
  }

  const grouped = new Map();
  state.filteredPasses.forEach((row) => {
    const key = valueKey(row[parameter]);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  const summaries = [...grouped.entries()]
    .map(([rawKey, rows]) => {
      const profits = rows.map((row) => number(row.Profit));
      const avgProfit = average(profits);
      const rawValue = rows[0] ? rows[0][parameter] : rawKey;
      return {
        value: formatParameterValue(rawValue, parameter),
        count: rows.length,
        avgProfit,
        medianProfit: median(profits),
        maxProfit: Math.max(...profits),
        profitableRate: rows.filter((row) => number(row.Profit) > 0).length / rows.length,
        qualityCount: rows.filter((row) => row._quality).length,
      };
    })
    .sort((a, b) => b.avgProfit - a.avgProfit);

  const maxAbs = Math.max(1, ...summaries.map((item) => Math.abs(item.avgProfit)));
  el.parameterBars.innerHTML = summaries
    .slice(0, 30)
    .map((item) => {
      const width = Math.max(3, (Math.abs(item.avgProfit) / maxAbs) * 100);
      const color = item.avgProfit >= 0 ? "var(--accent)" : "var(--red)";
      return `
        <div class="metric-bar">
          <div class="metric-name" title="${escapeHtml(item.value)}">${escapeHtml(item.value)}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${width}%; background:${color}"></div>
          </div>
          <div class="metric-meta">
            śr. ${formatMoney(item.avgProfit)} · med. ${formatMoney(item.medianProfit)} ·
            ${formatPercent(item.profitableRate)} · n=${formatInteger(item.count)}
          </div>
        </div>
      `;
    })
    .join("");
}

function renderStartHeatmap() {
  const hourColumn = "GodzinaStartuZakresu";
  const minuteColumn = "MinutaStartuZakresu";
  if (!state.data.columns.parameters.includes(hourColumn) || !state.data.columns.parameters.includes(minuteColumn)) {
    el.startHeatmap.innerHTML = `<p class="muted">Brak kolumn startu zakresu.</p>`;
    return;
  }

  const grouped = new Map();
  state.filteredPasses.forEach((row) => {
    const hour = String(row[hourColumn]).padStart(2, "0");
    const minute = String(row[minuteColumn]).padStart(2, "0");
    const key = `${hour}:${minute}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  const summaries = [...grouped.entries()]
    .map(([time, rows]) => {
      const profits = rows.map((row) => number(row.Profit));
      return {
        time,
        count: rows.length,
        avgProfit: average(profits),
        maxProfit: Math.max(...profits),
        qualityCount: rows.filter((row) => row._quality).length,
      };
    })
    .sort((a, b) => a.time.localeCompare(b.time));

  const maxAbs = Math.max(1, ...summaries.map((item) => Math.abs(item.avgProfit)));
  el.startHeatmap.innerHTML = `
    <div class="heatmap-grid">
      ${summaries
        .map((item) => {
          const strength = Math.min(1, Math.abs(item.avgProfit) / maxAbs);
          const color = item.avgProfit >= 0
            ? `rgba(31, 122, 104, ${0.12 + strength * 0.58})`
            : `rgba(185, 78, 72, ${0.12 + strength * 0.58})`;
          return `
            <div class="heat-cell" style="background:${color}">
              <strong>${escapeHtml(item.time)}</strong>
              <span>śr. ${formatMoney(item.avgProfit)}</span>
              <span>max ${formatMoney(item.maxProfit)}</span>
              <span>jakość ${formatInteger(item.qualityCount)} / ${formatInteger(item.count)}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderTabs() {
  el.tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === state.activeView);
  });
  el.views.forEach((view) => {
    view.classList.toggle("active", view.id === `${state.activeView}View`);
  });
  moveFilterPanel();
  attachSortHandlers();
}

function moveFilterPanel() {
  const mount = document.querySelector(`[data-filter-mount="${state.activeView}"]`);
  if (mount && !mount.contains(el.filterPanel)) {
    mount.appendChild(el.filterPanel);
  }
}

function average(values) {
  const clean = values.filter((value) => Number.isFinite(number(value)));
  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + number(value), 0) / clean.length;
}

function median(values) {
  const clean = values.map(number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function init() {
  setupControls();
  try {
    state.data = await loadDashboardData();
    populateStaticControls();
    applyFilters();
    render();
  } catch (error) {
    el.dataSummary.textContent = "Brak pliku danych dla dashboardu.";
    el.loadError.hidden = false;
    console.error(error);
  }
}

window.addEventListener("resize", () => {
  if (state.data) renderHistogram();
});

init();
