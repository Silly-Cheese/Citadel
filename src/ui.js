import { esc } from "./utils.js";

export function toast(title, message = "") {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<strong>${esc(title)}</strong>${message ? `<span>${esc(message)}</span>` : ""}`;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

export function openModal({ title, body, submitLabel = "Save", onSubmit, width = "620px" }) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop>
      <section class="modal" style="max-width:${esc(width)}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-head">
          <div class="modal-title-wrap"><span class="modal-kicker">Citadel</span><h2>${esc(title)}</h2></div>
          <button class="icon-btn modal-close" type="button" data-close-modal aria-label="Close">×</button>
        </div>
        <form data-modal-form class="modal-form">
          <div class="modal-body">${body}</div>
          <div class="modal-foot">
            <span class="modal-foot-hint">Changes are recorded in Citadel.</span>
            <div class="modal-foot-actions">
              <button class="btn btn-ghost" type="button" data-close-modal>Cancel</button>
              <button class="btn btn-primary" type="submit" data-submit-label="${esc(submitLabel)}">${esc(submitLabel)}</button>
            </div>
          </div>
        </form>
      </section>
    </div>
  `;

  const close = () => {
    document.removeEventListener("keydown", onKeydown);
    root.innerHTML = "";
  };
  const onKeydown = (event) => {
    if (event.key === "Escape") close();
  };
  document.addEventListener("keydown", onKeydown);
  root.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", close));
  root.querySelector("[data-modal-backdrop]").addEventListener("click", (e) => {
    if (e.target.matches("[data-modal-backdrop]")) close();
  });
  setTimeout(() => {
    root.querySelector("input:not([type='hidden']):not([disabled]), select:not([disabled]), textarea:not([disabled])")?.focus();
  }, 0);
  const form = root.querySelector("[data-modal-form]");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    const originalLabel = button.dataset.submitLabel || button.textContent;
    button.classList.add("is-loading");
    button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span><span>${esc(originalLabel)}</span>`;
    try {
      const shouldClose = await onSubmit(new FormData(form), form);
      if (shouldClose !== false) close();
    } finally {
      if (document.body.contains(button)) {
        button.disabled = false;
        button.classList.remove("is-loading");
        button.textContent = originalLabel;
      }
    }
  });
}

export function confirmDialog({ title, message, confirmLabel = "Confirm", danger = false, onConfirm }) {
  openModal({
    title,
    submitLabel: confirmLabel,
    body: `<div class="notice ${danger ? "danger" : ""}"><div><strong>${esc(title)}</strong><div>${esc(message)}</div></div></div>`,
    onSubmit: async () => {
      await onConfirm();
      return true;
    }
  });
}
