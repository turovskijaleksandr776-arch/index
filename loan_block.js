// ---- Кредиты (аннуитет, проценты по дням) ----
// Rate is annual; interest accrues DAILY on the outstanding balance
// (balance × rate × days / 365 or 366) and is paid with each monthly payment.
// Payments fall on the same day of the month, first one a month after the
// start date. The payment is the standard annuity for the term; the last one
// absorbs any difference. Early repayments take effect on their exact date,
// cut the payment (not the term) and the payment is recalculated.
function parseISODate(s){
  if(!s) return null;
  var d = new Date(s+'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}
function addMonthsClamped(d, k){
  var y = d.getFullYear(), m = d.getMonth()+k;
  var last = new Date(y, m+1, 0).getDate();
  return new Date(y, m, Math.min(d.getDate(), last));
}
function isLeapYear(y){ return (y%4===0 && y%100!==0) || y%400===0; }
function interestBetween(bal, ratePct, d1, d2){
  if(!(d2>d1) || bal<=0) return 0;
  var cur = d1, total = 0;
  while(cur < d2){
    var yearEnd = new Date(cur.getFullYear()+1, 0, 1);
    var segEnd = yearEnd < d2 ? yearEnd : d2;
    var days = Math.round((segEnd-cur)/86400000);
    total += bal*ratePct/100*days/(isLeapYear(cur.getFullYear())?366:365);
    cur = segEnd;
  }
  return total;
}
function annuityPayment(balance, r, n){
  if(n<=0) return balance;
  return r>0 ? balance*r/(1-Math.pow(1+r,-n)) : balance/n;
}

function simulateLoan(l, useExtras){
  var A = l.amount||0, ratePct = l.rate||0, rm = ratePct/1200, N = Math.round(l.termMonths||0);
  var override = l.paymentOverride||0;
  var start = parseISODate(l.startDate);
  if(!start){ start = new Date(); start.setHours(0,0,0,0); }
  var P = override>0 ? override : annuityPayment(A, rm, N);
  var extras = [];
  if(useExtras){
    (l.extras||[]).forEach(function(x){
      var d = parseISODate(x.date);
      if(d && (x.amount||0)>0) extras.push({date:d, amount:x.amount});
    });
    extras.sort(function(a,b){ return a.date-b.date; });
  }
  var rows = [], bal = A, cursor = start, accrued = 0, ei = 0, underpay = false;
  for(var k=1; k<=N && bal>0.005; k++){
    var pd = addMonthsClamped(start, k);
    while(ei<extras.length && extras[ei].date<pd && bal>0.005){
      var ex = extras[ei++];
      var exd = ex.date < cursor ? cursor : ex.date;
      accrued += interestBetween(bal, ratePct, cursor, exd);
      cursor = exd;
      var amt = Math.min(ex.amount, bal);
      bal -= amt;
      rows.push({extra:true, date:exd, amount:amt, balance:Math.max(0,bal)});
      if(bal>0.005) P = annuityPayment(bal, rm, N-k+1);
    }
    if(bal<=0.005) break;
    accrued += interestBetween(bal, ratePct, cursor, pd);
    cursor = pd;
    var pay = (k===N) ? bal+accrued : Math.min(P, bal+accrued);
    if(k<N && P<accrued) underpay = true;
    var principal = pay-accrued;
    bal -= principal;
    rows.push({extra:false, n:k, date:pd, pay:pay, interest:accrued, principal:principal, balance:Math.max(0,bal), P:P});
    accrued = 0;
  }
  return {rows:rows, underpay:underpay, hasDate:!!parseISODate(l.startDate)};
}

function loanStats(l){
  var A = l.amount||0, N = Math.round(l.termMonths||0);
  var override = l.paymentOverride||0;
  if(A<=0 || N<=0) return {ok:false, payment: override};
  var annuity = annuityPayment(A, (l.rate||0)/1200, N);
  var sim = simulateLoan(l, true), plain = simulateLoan(l, false);
  var today = new Date(); today.setHours(0,0,0,0);
  var paidCount=0, total=0, pPaid=0, iPaid=0, payPaid=0, pLeft=0, iLeft=0, payLeft=0;
  var extraPaid=0, extraLeft=0, nextRow=null, lastRow=null;
  sim.rows.forEach(function(row){
    var done = row.date <= today;
    if(row.extra){
      if(done){ extraPaid+=row.amount; pPaid+=row.amount; payPaid+=row.amount; }
      else { extraLeft+=row.amount; pLeft+=row.amount; payLeft+=row.amount; }
    } else {
      total++; lastRow=row;
      if(done){ paidCount++; pPaid+=row.principal; iPaid+=row.interest; payPaid+=row.pay; }
      else { pLeft+=row.principal; iLeft+=row.interest; payLeft+=row.pay; if(!nextRow) nextRow=row; }
    }
  });
  var interestNoExtras = plain.rows.reduce(function(s,row){ return s+(row.extra?0:row.interest); }, 0);
  var P = nextRow ? nextRow.P : (lastRow ? lastRow.P : (override>0?override:annuity));
  return {
    ok:true, underpay:sim.underpay, hasDate:sim.hasDate, payment:P, annuity:annuity, overridden:override>0,
    lastPay: lastRow ? lastRow.pay : 0, rows:sim.rows, nextRow:nextRow,
    totalPayments:total, paidCount:paidCount, leftCount:total-paidCount,
    principalPaid:pPaid, interestPaid:iPaid, paidTotal:payPaid,
    principalLeft:pLeft, interestLeft:iLeft, payLeft:payLeft,
    interestTotal:iPaid+iLeft, active: paidCount<total, end: lastRow ? lastRow.date : null,
    extraPaid:extraPaid, extraTotal:extraPaid+extraLeft,
    interestSaved:Math.max(0, interestNoExtras-(iPaid+iLeft)),
    hasExtras: sim.rows.some(function(r){return r.extra;})
  };
}

