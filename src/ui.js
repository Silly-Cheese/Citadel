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
      <section class="modal" style="max-width:${esc(width)}">
        <div class="modal-head">
          <h2>${esc(title)}</h2>
          <button class="icon-btn" type="button" data-close-modal aria-label="Close">×</button>
        </div>
        <form data-modal-form>
          <div class="modal-body">${body}</div>
          <div class="modal-foot">
            <button class="btn btn-ghost" type="button" data-close-modal>Cancel</button>
            <button class="btn btn-primary" type="submit">${esc(submitLabel)}</button>
          </div>
        </form>
      </section>
    </div>
  `;

  const close = () => { root.innerHTML = ""; };
  root.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", close));
  root.querySelector("[data-modal-backdrop]").addEventListener("click", (e) => {
    if (e.target.matches("[data-modal-backdrop]")) close();
  });
  const form = root.querySelector("[data-modal-form]");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const shouldClose = await onSubmit(new FormData(form), form);
      if (shouldClose !== false) close();
    } finally {
      if (document.body.contains(button)) button.disabled = false;
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
