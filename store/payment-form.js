import { loadMercadoPago } from "https://cdn.jsdelivr.net/npm/@mercadopago/sdk-js/+esm";

export class PaymentForm {
  constructor({
    publicKey,
    amount,
    containerId,
    onSubmit,
    onReady = () => {},
    onError = () => {},
  }) {
    this.publicKey = publicKey;
    this.amount = Number(amount);
    this.containerId = containerId;
    this.onSubmit = onSubmit;
    this.onReady = onReady;
    this.onError = onError;
    this.controller = null;
  }

  async mount() {
    if (!this.publicKey) throw new Error("Falta configurar VITE_MP_PUBLIC_KEY.");
    if (!Number.isFinite(this.amount) || this.amount <= 0) {
      throw new Error("El total del pago no es valido.");
    }

    await loadMercadoPago();
    const mercadoPago = new window.MercadoPago(this.publicKey, { locale: "es-MX" });
    this.controller = await mercadoPago.bricks().create("cardPayment", this.containerId, {
      initialization: {
        amount: this.amount,
      },
      customization: {
        visual: {
          style: {
            theme: "dark",
          },
        },
      },
      callbacks: {
        onReady: this.onReady,
        onError: this.onError,
        onSubmit: (cardData) => new Promise((resolve, reject) => {
          this.onSubmit(cardData).then(resolve).catch(reject);
        }),
      },
    });
  }

  async updateAmount(amount) {
    this.amount = Number(amount);
    if (this.controller?.update) {
      await this.controller.update({ amount: this.amount });
    }
  }

  unmount() {
    if (this.controller?.unmount) this.controller.unmount();
    this.controller = null;
  }
}
