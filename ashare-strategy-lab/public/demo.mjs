// An explicitly labelled synthetic snapshot. Values are design fixtures, not quotes.
export function demoCase() {
  return {
    stock: {
      day: '2026-11-20', code: '600001', name: '合成示例', sector: '工业科技', themeStatus: 'main',
      changePct: 5.6, turnoverPct: 14, amplitudePct: 7.2, amount: 18.4, floatCap: 62,
      auctionGapPct: 2.3, auctionVolumeRatio: 1.8, auctionAmount: 0.65, boardCount: 2,
      close: 16.42, ma5: 15.28, ma10: 14.76, ma20: 14.23, riskReward: 2.5
    },
    market: {
      allAStatus: 'bull', shStatus: 'bull', cybStatus: 'range',
      allAPct: 0.8, shPct: 0.42, cybPct: -0.26, allAClose: 5930, allAMa5: 5902,
      allAMa10: 5870, allAMa20: 5823, allAStreak: 2, advances: 3100, declines: 1400,
      amount: 11000, referenceAmount: 10200, highBoard: 5, emotion: 'upswing',
      priorSealPremium: 1.6, firstPremium: 1.1, limitDownToday: 7, limitDownYesterday: 10,
      failedSealToday: 12, failedSealYesterday: 16
    },
    portfolio: {
      positionPct: 0, themePositionPct: 8, totalPositionPct: 25, offThemePositionPct: 0,
      singleCapPct: 10, themeCapPct: 25, offThemeCapPct: 5, declineCapPct: 15,
      lossesToday: 0, lossDays: 0, stopLossPct: 4
    },
    evidence: {
      '1.1': 'yes', '1.2': 'yes', '1.3': 'yes', '1.4': 'yes', '1.5': 'yes', '1.6': 'yes',
      '56.1': 'no', '56.2': 'no', '56.3': 'no', '56.4': 'no', '56.5': 'no', '56.6': 'no'
    }
  };
}
