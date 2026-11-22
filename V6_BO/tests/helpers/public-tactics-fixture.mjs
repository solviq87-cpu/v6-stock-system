// Synthetic quotes used only to exercise individual rule boundaries.
export const demoMarket = {
    limits: 46, yesterdayLimits: 38, turnover: 8500, height: 4, leaderDrop: false,
    brokenPct: 17, sectorRank: 2, index: 3100, indexLow: 3050, previousLow: 3040,
    indexMA20: 3080, indexChange: 0.5, previousPhase: '回暖',
    turnover20: Array.from({ length: 20 }, (_, i) => 7000 + 100 * i),
    limits20: Array.from({ length: 20 }, (_, i) => 30 + i)
};
const sample = {
    code: '600519', name: '样本甲', close: 11, open: 10.3, low: 10.3, high: 11, ma5: 10.4, ma10: 10.1, ma20: 10,
    previousMa5: 9.95, previousMa20: 9.98, priorHigh20: 10.8, priorLow10: 9.7, firstLow: 9.4,
    return20: 12, rank20: .18, return5: 4, rank60: .14, bigShare: .3, smallShare: .55,
    turnPercentile: .5, turn: 16, volumeRatio: 2, seal: 610, opens: 0, gap: 3, auctionShare: 5, sectorRank: 2, sectorLimits: 4,
    role: '龙头', epsQ: 29, epsY: 28, news: 1, inst: 3, north: 4, superOrder: 6, ageMinutes: 4,
    boards: 1, priorLimits60: 2, yearGain: 30, floatYi: 80, priorLeaderFirst: false,
    priorWeak: false, priorLate: false, priorBroken: false, priorTurn: 14, priorUnderwater: false,
    heldVwap: true, tShape: false, resealVolume: .8, recentTurnSecond: false, newTheme: true,
    otherLimitNext: null, priorHigh: 10.6, sealShare: .02, sealFalling: false,
    frontLimit: true, frontAccelerating: false, frontReferenceSeal: 630, sealDuration: 5, frontReferenceDuration: 8, priorAcceleration: false,
    resealed: false, pullDays: 0, pullLow: 10, limitBodyMid: 9.8, priorBear: false, priorOpen: 10.5,
    priorLow: 10, priorClose: 10, firstBear: false, pullVolumeRatio: 1.3, platformRange: 9,
    nextInside: false, gapAge: 0, gapFloor: 10, gapMin: 10.1, gapDayRatio: 2,
    priorBandwidthRank: .15, upperBand: 10.9, midBand: 10.1, nextLostMa5: false,
    listedInstitution: true, nextGap: 2, sellerInstitution: false, sector5: 2, previousSector5: -1,
    priorSectorRank: 5, signalKind: '首板', signalFirstLow: 9.4, signalPlatformHigh: 10.8, signalOpen: 10.3, heldDays: 0, newHigh: true, heldFamily: '情绪',
    amplitude: 8, change: 10
};
export const demoQuotes = [
    sample, { ...sample, code: '000001', name: '样本乙', boards: 2, priorLeaderFirst: true, previous: sample, opens: 1 },
    { ...sample, code: '600036', name: '样本丙', boards: 0, change: 2, volumeRatio: 1.25, low: 10.08 },
    { ...sample, code: '000002', name: '样本丁', boards: 0, change: -3, close: 9.2, gap: -2, ageMinutes: 20 }
];
