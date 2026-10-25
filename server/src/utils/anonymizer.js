// server/src/utils/anonymizer.js
export function anonymizeCounterparty(name, inn) {
  const safeName = String(name || '');
  const safeInn = String(inn || '');
  const maskedName = safeName.length > 2 ? safeName.substring(0, 2) + '***' : '***';
  const maskedInn = safeInn.length > 4 ? safeInn.substring(0, 2) + '******' + safeInn.substring(safeInn.length - 2) : '**********';

  return {
    name: maskedName,
    inn: maskedInn
  };
}