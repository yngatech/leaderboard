/**
 * Progressive enhancement for the pre-rendered pages. Everything here is
 * additive: the page is complete and correct before this file loads, so
 * nothing below may create content the markup lacks — it only upgrades it.
 * Plain JS on purpose: it is served verbatim via a `?url` import, unbundled.
 */

/* Relative "updated N minutes ago", ticking while the tab is open. The server
   bakes in the absolute time because a cached page cannot know how old it is
   by the time it is read. Mirrors formatAgo in shared/format.ts. */
function formatAgo(iso, now) {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

const stamps = document.querySelectorAll("time[data-ago]");
if (stamps.length > 0) {
  const tick = () => {
    const now = Date.now();
    for (const stamp of stamps) {
      const iso = stamp.getAttribute("datetime");
      if (iso) stamp.textContent = formatAgo(iso, now);
    }
  };
  tick();
  setInterval(tick, 30_000);
}

/* Arrow keys walk the years, using the targets the page carries as data
   attributes; the script never re-derives routing. */
document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return;
  }
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

  const target = event.target;
  if (target instanceof Element && target.closest("a[data-day]")) return;
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  ) {
    return;
  }

  const href =
    event.key === "ArrowLeft" ? document.body.dataset.prevHref : document.body.dataset.nextHref;
  if (!href) return;
  event.preventDefault();
  window.location.assign(href);
});

/* Hover readout for the cumulative chart: a crosshair on the hovered day and
   a panel with every account's running total, fed by the JSON block the chart
   rendered next to itself. */
const chart = document.getElementById("climb");
const dataBlock = document.getElementById("climb-data");
if (chart && dataBlock) {
  const data = JSON.parse(dataBlock.textContent ?? "{}");
  const series = Array.isArray(data.series) ? data.series : [];
  const drawnDays = series.reduce((most, item) => Math.max(most, item.totals.length), 0);

  if (drawnDays > 0) {
    const dayFmt = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
    const numberFmt = new Intl.NumberFormat("en-GB");
    const jan1 = Date.UTC(data.year, 0, 1);

    const svgNs = "http://www.w3.org/2000/svg";
    const crosshair = document.createElementNS(svgNs, "line");
    crosshair.setAttribute("class", "stroke-[rgba(236,234,247,0.35)]");
    crosshair.setAttribute("y1", "18");
    crosshair.setAttribute("y2", String(chart.viewBox.baseVal.height - 22));
    crosshair.style.display = "none";
    chart.appendChild(crosshair);

    const panel = document.createElement("div");
    panel.className =
      "pointer-events-none absolute z-10 rounded-[9px] border border-line bg-[rgba(8,10,22,0.95)] px-[0.7rem] py-[0.55rem] font-mono text-[0.68rem] leading-[1.5]";
    panel.style.display = "none";
    const holder = chart.parentElement;
    holder.appendChild(panel);

    const hide = () => {
      crosshair.style.display = "none";
      panel.style.display = "none";
    };

    chart.addEventListener("pointerleave", hide);
    chart.addEventListener("pointermove", (event) => {
      const box = chart.getBoundingClientRect();
      if (box.width <= 0) return;
      const scale = data.width / box.width;
      const x = (event.clientX - box.left) * scale;
      const day = Math.round(((x - data.padLeft) / data.plotWidth) * data.span);
      if (day < 0 || day >= drawnDays) {
        hide();
        return;
      }

      const chartX = data.padLeft + (day / data.span) * data.plotWidth;
      crosshair.setAttribute("x1", chartX.toFixed(1));
      crosshair.setAttribute("x2", chartX.toFixed(1));
      crosshair.style.display = "";

      const date = dayFmt.format(new Date(jan1 + day * 86_400_000));
      const rows = series
        .map((item) => ({ login: item.login, colour: item.colour, total: item.totals[Math.min(day, item.totals.length - 1)] ?? 0 }))
        .sort((a, b) => b.total - a.total || a.login.localeCompare(b.login));

      panel.replaceChildren();
      const heading = document.createElement("p");
      heading.className = "mb-[0.35rem] text-dimmer tracking-[0.08em] uppercase text-[0.58rem]";
      heading.textContent = date;
      panel.appendChild(heading);
      for (const row of rows) {
        const line = document.createElement("p");
        line.className = "flex items-baseline gap-[0.55rem] whitespace-nowrap";
        const mark = document.createElement("span");
        mark.className = "inline-block h-[9px] w-[2px] flex-none rounded-full";
        mark.style.background = row.colour;
        const name = document.createElement("span");
        name.className = "text-ink";
        name.textContent = row.login;
        const total = document.createElement("span");
        total.className = "ml-auto text-dim tabular-nums";
        total.textContent = numberFmt.format(row.total);
        line.append(mark, name, total);
        panel.appendChild(line);
      }

      // Keep the panel beside the pointer, clamped inside the chart's box.
      const holderBox = holder.getBoundingClientRect();
      panel.style.display = "";
      const panelBox = panel.getBoundingClientRect();
      const flip = event.clientX + 16 + panelBox.width > holderBox.right;
      const left = flip
        ? event.clientX - holderBox.left - panelBox.width - 12
        : event.clientX - holderBox.left + 12;
      const top = Math.min(
        Math.max(0, event.clientY - holderBox.top - panelBox.height / 2),
        holderBox.height - panelBox.height,
      );
      panel.style.left = `${Math.max(0, left)}px`;
      panel.style.top = `${top}px`;
    });
  }
}

/* The README snippet's copy button. Ships hidden and stays hidden without a
   clipboard: the snippet itself is selectable text either way, so nothing is
   lost, and a button that cannot copy is worse than no button. */
const copyButtons = document.querySelectorAll("button[data-copy]");
if (navigator.clipboard) {
  for (const button of copyButtons) {
    const source = document.getElementById(button.getAttribute("data-copy"));
    if (!source) continue;
    const label = button.textContent;
    let restore;
    button.hidden = false;
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(source.textContent.trim());
      } catch {
        return;
      }
      // Clicked twice inside the window, the second timer would otherwise
      // restore "copied" and leave it there.
      clearTimeout(restore);
      button.textContent = "copied";
      restore = setTimeout(() => {
        button.textContent = label;
      }, 1600);
    });
  }
}

/* Day detail is rendered on the destination page; only transplant that markup. */
let dayRequest = 0;
function clearSelectedDay() {
  for (const cell of document.querySelectorAll("a[data-day] .heat-cell[data-selected]"))
    cell.removeAttribute("data-selected");
}
function closeDay(link) {
  ++dayRequest;
  document.getElementById("day-breakdown")?.remove();
  clearSelectedDay();
  history.pushState({}, "", link.getAttribute("href"));
}
function plainDayClick(event) {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
document.addEventListener("click", async (event) => {
  if (!plainDayClick(event)) return;
  const link = event.target instanceof Element ? event.target.closest("a[data-day]") : null;
  const close = event.target instanceof Element ? event.target.closest("a[data-day-close]") : null;
  if (close) {
    event.preventDefault();
    closeDay(close);
    return;
  }
  const slot = document.querySelector("[data-day-slot]");
  if (!link || !slot) return;
  event.preventDefault();
  const href = link.getAttribute("href");
  const request = ++dayRequest;
  // GitHub takes a moment to answer for a day, so acknowledge the click now:
  // the cell lights up and any open panel dims until the new one lands.
  clearSelectedDay();
  link.querySelector(".heat-cell")?.setAttribute("data-selected", "true");
  document.getElementById("day-breakdown")?.setAttribute("aria-busy", "true");
  try {
    const response = await fetch(href);
    if (!response.ok) throw new Error("Day unavailable");
    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    const detail = doc.getElementById("day-breakdown");
    if (!detail) throw new Error("Missing day detail");
    if (request !== dayRequest) return;
    /* The day detail is reconciled against the fetched page's heatmap. If the
       board has moved on since this page was drawn, transplanting it would
       put two different counts side by side, so load the whole page. */
    const day = link.getAttribute("data-day");
    const cellLabel = (root) => root.querySelector(`a[data-day="${day}"]`)?.getAttribute("aria-label");
    // The heatmap's own label carries the year total, and is drawn even when
    // the year breakdown is not.
    const yearTotal = (root) =>
      root.querySelector(`a[data-day="${day}"]`)?.closest("svg")?.getAttribute("aria-label");
    if (cellLabel(doc) !== cellLabel(document) || yearTotal(doc) !== yearTotal(document)) {
      location.assign(href);
      return;
    }
    const old = document.getElementById("day-breakdown");
    if (old) old.replaceWith(detail);
    else slot.after(detail);
    clearSelectedDay();
    link.querySelector(".heat-cell")?.setAttribute("data-selected", "true");
    history.pushState({ day: true }, "", href);
      detail.scrollIntoView({ block: "nearest" });
  } catch {
    if (request === dayRequest) location.assign(href);
  }
});
/* History entries made here share one document, so whenever the day in the
   URL and the day on screen part ways, load the page the URL names. */
window.addEventListener("popstate", () => {
  const wanted = new URLSearchParams(location.search).get("day");
  const shown = document.getElementById("day-breakdown")?.getAttribute("data-date") ?? null;
  if (wanted !== shown) location.reload();
});
