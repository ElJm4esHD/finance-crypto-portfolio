// Number formatting for user-facing error messages (Argentine locale).
const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 8 });

export const fmt = (n) => nf.format(n);
