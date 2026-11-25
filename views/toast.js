// Floating messages. They live in their own container outside #app, because the app re-renders #app
// constantly and that would restart the countdown bar.
export const TOAST_MS = 10000;
const MAX_TOASTS = 4;
const dismissers = new WeakMap();

function container() {
  let box = document.getElementById("toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    box.className = "toasts";
    document.body.append(box);
  }
  return box;
}

export function showToast(kind, message, { ms = TOAST_MS } = {}) {
  const text = String(message ?? "").trim();
  if (!text) return null;
  const box = container();
  for (const old of box.querySelectorAll(".toast")) {
    if (old.dataset.kind === kind && old.dataset.text === text) dismissers.get(old)?.();
  }

  const toast = document.createElement("div");
  toast.className = `toast ${kind}`;
  toast.dataset.kind = kind;
  toast.dataset.text = text;
  toast.setAttribute("role", kind === "error" ? "alert" : "status");
  toast.style.setProperty("--toast-ms", `${ms}ms`);
  const body = document.createElement("p");
  body.textContent = text;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.setAttribute("aria-label", "Fechar mensagem");
  close.textContent = "×";
  const bar = document.createElement("div");
  bar.className = "toast-bar";
  bar.setAttribute("aria-hidden", "true");
  bar.append(document.createElement("i"));
  toast.append(body, close, bar);

  let remaining = ms;
  let startedAt = Date.now();
  let timer = null;
  const done = () => {
    clearTimeout(timer);
    timer = null;
    toast.remove();
  };
  const resume = () => {
    if (timer !== null || !toast.isConnected) return;
    startedAt = Date.now();
    timer = setTimeout(done, Math.max(remaining, 0));
    toast.classList.remove("paused");
  };
  // Hovering or focusing a toast stops both the timer and the bar, so there is time to read or copy it.
  const pause = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    remaining -= Date.now() - startedAt;
    toast.classList.add("paused");
  };
  dismissers.set(toast, done);
  close.addEventListener("click", done);
  toast.addEventListener("mouseenter", pause);
  toast.addEventListener("mouseleave", resume);
  toast.addEventListener("focusin", pause);
  toast.addEventListener("focusout", resume);

  box.append(toast);
  timer = setTimeout(done, remaining);
  while (box.children.length > MAX_TOASTS) dismissers.get(box.firstElementChild)?.();
  return toast;
}
