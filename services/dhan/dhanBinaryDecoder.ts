type ExchangeSegment =
  | "IDX_I"
  | "NSE_EQ"
  | "NSE_FNO"
  | "NSE_CURRENCY"
  | "BSE_EQ"
  | "MCX_COMM"
  | "BSE_CURRENCY"
  | "BSE_FNO"
  | "UNKNOWN";

const exchangeByCode: Record<number, ExchangeSegment> = {
  0: "IDX_I",
  1: "NSE_EQ",
  2: "NSE_FNO",
  3: "NSE_CURRENCY",
  4: "BSE_EQ",
  5: "MCX_COMM",
  7: "BSE_CURRENCY",
  8: "BSE_FNO"
};

function exchangeSegment(code: number): ExchangeSegment {
  return exchangeByCode[code] ?? "UNKNOWN";
}

function toIsoFromEpoch(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function readHeader(view: DataView) {
  const responseCode = view.getUint8(0);
  const messageLength = view.getInt16(1, true);
  const exchangeCode = view.getUint8(3);
  const securityId = String(view.getInt32(4, true));

  return {
    responseCode,
    messageLength,
    exchangeCode,
    exchangeSegment: exchangeSegment(exchangeCode),
    securityId
  };
}

function parseTicker(view: DataView, header: ReturnType<typeof readHeader>) {
  return {
    type: "ticker",
    ...header,
    ltp: view.getFloat32(8, true),
    lttEpoch: view.getInt32(12, true),
    ltt: toIsoFromEpoch(view.getInt32(12, true))
  };
}

function parseIndex(view: DataView, header: ReturnType<typeof readHeader>) {
  return {
    ...parseTicker(view, header),
    type: "index"
  };
}

function parsePrevClose(view: DataView, header: ReturnType<typeof readHeader>) {
  return {
    type: "prev_close",
    ...header,
    prevClose: view.getFloat32(8, true),
    prevOpenInterest: view.getInt32(12, true)
  };
}

function parseOI(view: DataView, header: ReturnType<typeof readHeader>) {
  return {
    type: "oi",
    ...header,
    openInterest: view.getInt32(8, true)
  };
}

function parseDisconnect(view: DataView, header: ReturnType<typeof readHeader>) {
  return {
    type: "disconnect",
    ...header,
    reasonCode: view.byteLength >= 10 ? view.getInt16(8, true) : undefined
  };
}

function parseQuote(view: DataView, header: ReturnType<typeof readHeader>) {
  return {
    type: "quote",
    ...header,
    ltp: view.getFloat32(8, true),
    lastTradedQuantity: view.getInt16(12, true),
    lttEpoch: view.getInt32(14, true),
    ltt: toIsoFromEpoch(view.getInt32(14, true)),
    atp: view.getFloat32(18, true),
    volume: view.getInt32(22, true),
    totalSellQty: view.getInt32(26, true),
    totalBuyQty: view.getInt32(30, true),
    open: view.getFloat32(34, true),
    close: view.getFloat32(38, true),
    high: view.getFloat32(42, true),
    low: view.getFloat32(46, true)
  };
}

function parseFull(view: DataView, header: ReturnType<typeof readHeader>) {
  const depth: Array<{
    bidQty: number;
    askQty: number;
    bidOrders: number;
    askOrders: number;
    bidPrice: number;
    askPrice: number;
  }> = [];
  let offset = 62;

  for (let i = 0; i < 5; i += 1) {
    depth.push({
      bidQty: view.getInt32(offset, true),
      askQty: view.getInt32(offset + 4, true),
      bidOrders: view.getInt16(offset + 8, true),
      askOrders: view.getInt16(offset + 10, true),
      bidPrice: view.getFloat32(offset + 12, true),
      askPrice: view.getFloat32(offset + 16, true)
    });
    offset += 20;
  }

  return {
    type: "full",
    ...header,
    ltp: view.getFloat32(8, true),
    lastTradedQuantity: view.getInt16(12, true),
    lttEpoch: view.getInt32(14, true),
    ltt: toIsoFromEpoch(view.getInt32(14, true)),
    atp: view.getFloat32(18, true),
    volume: view.getInt32(22, true),
    totalSellQty: view.getInt32(26, true),
    totalBuyQty: view.getInt32(30, true),
    openInterest: view.getInt32(34, true),
    dayHighOi: view.getInt32(38, true),
    dayLowOi: view.getInt32(42, true),
    open: view.getFloat32(46, true),
    close: view.getFloat32(50, true),
    high: view.getFloat32(54, true),
    low: view.getFloat32(58, true),
    depth,
    bidQty: depth[0]?.bidQty ?? 0,
    askQty: depth[0]?.askQty ?? 0,
    bidPrice: depth[0]?.bidPrice ?? 0,
    askPrice: depth[0]?.askPrice ?? 0
  };
}

export function decodeDhanFeedPacket(buf: Buffer) {
  if (!buf || buf.byteLength < 8) {
    return { type: "unknown", reason: "short-packet" };
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const header = readHeader(view);

  try {
    if (header.responseCode === 1 && buf.byteLength >= 16) return parseIndex(view, header);
    if (header.responseCode === 2 && buf.byteLength >= 16) return parseTicker(view, header);
    if (header.responseCode === 4 && buf.byteLength >= 50) return parseQuote(view, header);
    if (header.responseCode === 5 && buf.byteLength >= 12) return parseOI(view, header);
    if (header.responseCode === 6 && buf.byteLength >= 16) return parsePrevClose(view, header);
    if (header.responseCode === 8 && buf.byteLength >= 162) return parseFull(view, header);
    if (header.responseCode === 50) return parseDisconnect(view, header);

    return {
      type: "unknown",
      ...header,
      byteLength: buf.byteLength,
      payloadBase64: buf.toString("base64")
    };
  } catch (error) {
    return {
      type: "decode_error",
      ...header,
      byteLength: buf.byteLength,
      message: error instanceof Error ? error.message : "Decode failed"
    };
  }
}
