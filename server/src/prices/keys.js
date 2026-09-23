// Key used to identify a CEDEAR/ETF position (same ticker can exist in USD and ARS).
export const marketKey = (ticker, currency) => `${ticker}|${currency}`;
