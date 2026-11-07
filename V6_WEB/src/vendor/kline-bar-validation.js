'use strict';
/** Keep partial/missing OHLCV out of research. Number(null), Number(' ') and
 * Number(false) are zero, which would otherwise manufacture valid volume. */
const numericInput = value =>
 (typeof value === 'number' && Number.isFinite(value)) ||
 (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)));
const completeOHLCV = row => !!row && typeof row === 'object' &&
 ['open','high','low','close'].every(key=>numericInput(row[key])) &&
 numericInput(row.volume ?? row.vol);
module.exports = {completeOHLCV};
