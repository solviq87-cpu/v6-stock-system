'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {annualBackgroundComparison}=require('../src/core/worldbank-indicators');
const calc=(rows,startYear=2023,endYear=2025)=>annualBackgroundComparison({rows,startYear,endYear});
test('consecutive annual periods preserve zero and never become credit, expectation or trade claims',()=>{const r=calc([{year:2024,value:0},{year:2025,value:2}]);assert.equal(r.delta,2);assert.equal(r.direction,'increase');assert.equal(r.creditEconomicState,null);assert.equal(r.expectationGap,null);assert.equal(r.pointInTimeBacktestReady,false);assert.equal(r.canTrade,false);});
test('missing latest requested year or previous year stays unknown without falling back',()=>{for(const rows of [[{year:2023,value:1},{year:2024,value:3}],[{year:2023,value:1},{year:2025,value:3}],[{year:2024,value:null},{year:2025,value:3}]])assert.equal(calc(rows).delta,null);});
test('one-year request and duplicate or overflowed values remain unknown',()=>{assert.equal(calc([{year:2024,value:1},{year:2025,value:2}],2025).delta,null);assert.equal(calc([{year:2024,value:1},{year:2025,value:2},{year:2025,value:3}]).delta,null);assert.equal(calc([{year:2024,value:-Number.MAX_VALUE},{year:2025,value:Number.MAX_VALUE}]).delta,null);});
