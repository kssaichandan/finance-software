'use strict';

// Display names of supported help-page languages. Phase 2 ships English only;
// subsequent phases add Hindi, Kannada, Telugu, Tamil, Malayalam, Marathi.
window.HELP_LANGS = {
  en: 'English',
  hi: 'हिन्दी',
  kn: 'ಕನ್ನಡ',
  te: 'తెలుగు',
  ta: 'தமிழ்',
  ml: 'മലയാളം',
  mr: 'मराठी',
};

window.HELP_CONTENT = {
  en: {
    title: 'Help — How Finance Tracker Works',
    subtitle: 'A quick guide to using this app',
    sections: [
      {
        h: 'What this app does',
        body: `<p>This app helps you track loans you give to borrowers. Record each
          person's loan details, the payments they make, and any overdue
          penalties. The Dashboard shows who is due today and who has recently
          missed a payment. The Portfolio page summarises your full lending book.</p>
          <p>All data is saved in <b>finance.db</b> on your computer —
          nothing is sent over the internet.</p>`,
      },
      {
        h: 'Quick workflow',
        body: `<ul>
          <li><b>+ New Loan</b> → fill borrower, vehicle, and loan details → Save</li>
          <li>Open a borrower → <b>+ Add Payment</b> when they pay you</li>
          <li>Open a borrower → <b>⚠ Add Penalty (O/D)</b> for overdue charges</li>
          <li><b>Dashboard</b> shows who is due today / tomorrow and who recently missed</li>
          <li><b>Borrowers</b> list lets you filter by overdue duration or amount</li>
          <li>When the loan is paid off → open borrower → <b>✔ Mark Closed</b></li>
        </ul>`,
      },
      {
        h: 'How interest is calculated',
        body: `<p>The interest rate is treated as <b>annual</b>, prorated by loan months:</p>
          <ul>
            <li>Effective rate = Interest % × (Months ÷ 12)</li>
            <li>Total Payable = Principal × (1 + Effective rate ÷ 100)</li>
            <li>Monthly EMI = Total Payable ÷ Months</li>
          </ul>
          <p><b>Example:</b> ₹70,000 at 24% per year for 6 months</p>
          <ul>
            <li>Effective rate = 24% × (6 ÷ 12) = 12%</li>
            <li>Total Payable = 70,000 × 1.12 = ₹78,400</li>
            <li>Monthly EMI = 78,400 ÷ 6 = ₹13,067</li>
          </ul>`,
      },
      {
        h: 'Loan form fields',
        body: `<ul>
          <li><b>Principal Amount</b> — the money you gave to the borrower</li>
          <li><b>Interest Rate (% per year)</b> — annual rate, default 24</li>
          <li><b>Period (months)</b> — how many months the loan runs for</li>
          <li><b>Loan Date</b> — the day money was given. Each EMI is due on the same day of the following months.</li>
          <li><b>Total Payable</b> — auto-calculated. Principal + total interest.</li>
          <li><b>Monthly Installment (EMI)</b> — auto-calculated. What's due each month. You can override if needed.</li>
          <li><b>Book No / S.No</b> — your physical register reference. Must be unique if filled. Optional.</li>
        </ul>`,
      },
      {
        h: 'Summary fields (in borrower detail)',
        body: `<ul>
          <li><b>Paid So Far</b> — sum of all payments received from this borrower</li>
          <li><b>Remaining</b> — Total Payable minus Paid So Far. What they still owe.</li>
          <li><b>Expected by Today</b> — what they SHOULD have paid by today
            (months elapsed × EMI). Capped at the total payable.</li>
          <li><b>Overdue Amount</b> — Expected by Today minus Paid So Far.
            Positive means they're behind.</li>
          <li><b>Days Overdue</b> — days since the very first missed installment due date</li>
          <li><b>Months Elapsed</b> — whole months since the loan was given,
            using the same day-of-month rule</li>
          <li><b>Penalties Paid</b> — total O/D (overdue) charges, tracked
            separately from the loan itself</li>
          <li><b>Last Payment</b> — date of the most recent payment received</li>
        </ul>`,
      },
      {
        h: 'Status labels',
        body: `<ul>
          <li>🔴 <b>Overdue</b> — borrower has paid less than expected by today</li>
          <li>🟢 <b>On Time</b> — paying on schedule, no money overdue</li>
          <li>🟢 <b>Advance</b> — has paid MORE than expected (ahead of schedule)</li>
          <li>⚪ <b>Closed</b> — loan is fully paid off and marked complete</li>
        </ul>`,
      },
      {
        h: 'Filter options (Borrowers list)',
        body: `<p>Open the <b>🔧 Filters</b> panel above the table. Every section you set is
          combined with <b>AND</b> — a borrower must match <b>all</b> of them (plus the search boxes):</p>
          <ul>
            <li><b>Status</b> — Active + Closed / Active only / Closed only</li>
            <li><b>Standing</b> — Overdue / On time / Advance (paid ahead)</li>
            <li><b>Overdue severity</b> — ≥ 30 / 60 / 90 days behind, or over ₹1,000 / ₹5,000</li>
            <li><b>Due date</b> — due today / tomorrow / in 3 / 7 days, or on a date you pick</li>
            <li><b>Place / Showroom / Vehicle type</b> — pick from values already entered</li>
            <li><b>Loan amount</b> and <b>Loan date</b> ranges</li>
            <li><b>Flags</b> — has penalty / has seizing</li>
            <li><b>Custom conditions</b> — build your own (e.g. <i>Days overdue &gt; 45</i>).
              <b>All</b> custom conditions must match.</li>
          </ul>
          <p>Click a column header (Name, Loan Date, Principal, Overdue, Status) to sort.
          <b>Clear all</b> resets every filter.</p>`,
      },
      {
        h: 'More features',
        body: `<ul>
          <li><b>🔍 Find borrower</b> (sidebar) — jump to anyone by name / phone / vehicle / book no, from any screen.</li>
          <li><b>🧾 Receipt search</b> — the second box on the Borrowers page finds a payment by its receipt number.</li>
          <li><b>Payment mode</b> — tag each payment as Cash, PhonePe, or Scanner.</li>
          <li><b>💬 Remind</b> — opens a ready-made WhatsApp reminder for a due / overdue borrower.</li>
          <li><b>Seizing Money</b> — record repossession / towing / garage costs against a borrower.</li>
          <li><b>🖨 Print</b> — print one borrower's full statement; <b>Export to PDF</b> prints the whole filtered list.</li>
          <li><b>💾 Backup</b> (Settings) — save a full copy of your data to Downloads. Do this often.</li>
          <li><b>🔐 Delete password</b> (Settings) — require a password before any delete.</li>
          <li><b>Text size</b> (Settings) — make everything bigger.</li>
        </ul>`,
      },
      {
        h: 'Backup your data',
        body: `<p>All your data lives in <b>one file</b>:
          <code>finance.db</code> next to <code>FinanceTracker.exe</code>.</p>
          <p><b>Easiest:</b> go to <b>Settings → 💾 Back up now</b> — it saves a dated
          copy into your Downloads folder. Then copy that file to USB / Google Drive / OneDrive.</p>
          <p><b>Manual backup:</b> close the app → copy <code>finance.db</code>
          to USB / Google Drive / OneDrive.</p>
          <p><b>To restore on a new computer:</b> place <code>finance.db</code>
          next to a fresh <code>FinanceTracker.exe</code> and run it.</p>`,
      },
    ],
  },

  hi: {
    title: 'सहायता — Finance Tracker कैसे काम करता है',
    subtitle: 'इस ऐप को इस्तेमाल करने की संक्षिप्त मार्गदर्शिका',
    sections: [
      {
        h: 'यह ऐप क्या करता है',
        body: `<p>यह ऐप आपको उन ऋणों का हिसाब रखने में मदद करता है जो आप ग्राहकों को देते हैं।
          हर व्यक्ति का ऋण विवरण, उनकी किस्तें और बकाया जुर्माना दर्ज करें।
          डैशबोर्ड पर देखें कि आज किसकी किस्त बाकी है और किसने हाल ही में
          किस्त नहीं चुकाई। Portfolio पेज पर आपके पूरे लेन-देन का सार दिखता है।</p>
          <p>आपका सारा डेटा आपके कंप्यूटर पर <b>finance.db</b> फाइल में सुरक्षित रहता है —
          इंटरनेट पर कुछ नहीं भेजा जाता।</p>`,
      },
      {
        h: 'जल्दी इस्तेमाल का तरीका',
        body: `<ul>
          <li><b>+ New Loan</b> → ग्राहक, वाहन और ऋण की जानकारी भरें → Save दबाएँ</li>
          <li>ग्राहक खोलें → जब वे पैसे दें तब <b>+ Add Payment</b> दबाएँ</li>
          <li>ग्राहक खोलें → बकाया चार्ज के लिए <b>⚠ Add Penalty (O/D)</b></li>
          <li><b>Dashboard</b> आज/कल की किस्त और हाल में मिस्ड दिखाता है</li>
          <li><b>Borrowers</b> सूची में बकाया दिनों या रकम के हिसाब से छानें</li>
          <li>ऋण पूरा चुकता होने पर → ग्राहक खोलें → <b>✔ Mark Closed</b></li>
        </ul>`,
      },
      {
        h: 'ब्याज की गणना कैसे होती है',
        body: `<p>ब्याज दर <b>सालाना</b> मानी जाती है और ऋण के महीनों के अनुसार बंटती है:</p>
          <ul>
            <li>असरदार दर = ब्याज % × (महीने ÷ 12)</li>
            <li>कुल देय = मूलधन × (1 + असरदार दर ÷ 100)</li>
            <li>मासिक किस्त (EMI) = कुल देय ÷ महीने</li>
          </ul>
          <p><b>उदाहरण:</b> ₹70,000, 24% सालाना, 6 महीने के लिए</p>
          <ul>
            <li>असरदार दर = 24% × (6 ÷ 12) = 12%</li>
            <li>कुल देय = 70,000 × 1.12 = ₹78,400</li>
            <li>मासिक किस्त = 78,400 ÷ 6 = ₹13,067</li>
          </ul>`,
      },
      {
        h: 'ऋण फ़ॉर्म के फील्ड',
        body: `<ul>
          <li><b>Principal Amount (मूलधन)</b> — जो रकम आपने ग्राहक को दी</li>
          <li><b>Interest Rate (% per year)</b> — सालाना ब्याज दर, सामान्यत: 24</li>
          <li><b>Period (months)</b> — ऋण कितने महीनों के लिए है</li>
          <li><b>Loan Date</b> — पैसे देने की तारीख। हर किस्त अगले महीनों की उसी तारीख को देय होती है।</li>
          <li><b>Total Payable</b> — स्वत: गणना। मूलधन + पूरा ब्याज।</li>
          <li><b>Monthly Installment (EMI)</b> — स्वत: गणना। हर महीने देय रकम। ज़रूरत हो तो खुद बदल सकते हैं।</li>
          <li><b>Book No / S.No</b> — आपकी रजिस्टर बही का नंबर। भरा तो यह अनोखा होना ज़रूरी है। वैकल्पिक।</li>
        </ul>`,
      },
      {
        h: 'सारांश के फील्ड (ग्राहक विवरण में)',
        body: `<ul>
          <li><b>Paid So Far</b> — इस ग्राहक से मिली सारी किस्तों का योग</li>
          <li><b>Remaining</b> — कुल देय में से चुकाई गई रकम घटाने पर बचा हिसाब</li>
          <li><b>Expected by Today</b> — आज तक जितनी रकम चुकानी चाहिए थी
            (बीते महीने × EMI)। कुल देय से ज़्यादा नहीं होती।</li>
          <li><b>Overdue Amount</b> — Expected by Today में से Paid So Far घटाने पर।
            धनात्मक है तो ग्राहक पिछड़ रहा है।</li>
          <li><b>Days Overdue</b> — पहली मिस्ड किस्त की देय तारीख से कितने दिन हो गए</li>
          <li><b>Months Elapsed</b> — ऋण देने की तारीख से कितने पूरे महीने बीते</li>
          <li><b>Penalties Paid</b> — कुल बकाया जुर्माना (ऋण से अलग रखा जाता है)</li>
          <li><b>Last Payment</b> — आख़िरी किस्त मिलने की तारीख</li>
        </ul>`,
      },
      {
        h: 'स्थिति के लेबल',
        body: `<ul>
          <li>🔴 <b>Overdue (बकाया)</b> — ग्राहक ने आज तक से कम चुकाया है</li>
          <li>🟢 <b>On Time (समय पर)</b> — समय पर चुका रहा है, कुछ बकाया नहीं</li>
          <li>🟢 <b>Advance (अग्रिम)</b> — आज तक से ज़्यादा चुका दिया (आगे चल रहा है)</li>
          <li>⚪ <b>Closed (बंद)</b> — ऋण पूरी तरह चुक गया और बंद कर दिया</li>
        </ul>`,
      },
      {
        h: 'फिल्टर विकल्प (Borrowers सूची में)',
        body: `<ul>
          <li><b>All Active</b> — हर चालू ऋण</li>
          <li><b>Overdue (any)</b> — जो भी बकाया चला रहा है</li>
          <li><b>Overdue &gt; 1 / 2 / 3 महीने</b> — 30 / 60 / 90+ दिनों से पिछड़े</li>
          <li><b>Overdue &gt; ₹1,000 / ₹5,000</b> — बकाया रकम के हिसाब से</li>
          <li><b>Custom</b> — खुद अपनी सीमाएँ डालें। कोई भी एक शर्त पूरी करने वाले दिखते हैं।</li>
          <li><b>Due Today / Tomorrow / 3 / 7 दिन</b> — अगली किस्त उस अवधि में आती है</li>
          <li><b>Pick Date</b> — खास तारीख पर देय ग्राहक दिखाएँ</li>
        </ul>`,
      },
      {
        h: 'अपने डेटा का बैकअप',
        body: `<p>आपका सारा डेटा <b>एक ही फाइल</b> में है:
          <code>FinanceTracker.exe</code> के पास <code>finance.db</code>।</p>
          <p><b>हफ़्ते में एक बार बैकअप:</b> ऐप बंद करें → <code>finance.db</code>
          को USB / Google Drive / OneDrive पर कॉपी करें।</p>
          <p><b>नए कंप्यूटर पर वापस लाना:</b> नई <code>FinanceTracker.exe</code> के पास
          अपनी <code>finance.db</code> रखें और चला दें।</p>`,
      },
    ],
  },

  kn: {
    title: 'ಸಹಾಯ — Finance Tracker ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ',
    subtitle: 'ಈ ಆ್ಯಪ್ ಬಳಸಲು ಸಣ್ಣ ಮಾರ್ಗದರ್ಶಿ',
    sections: [
      {
        h: 'ಈ ಆ್ಯಪ್ ಏನು ಮಾಡುತ್ತದೆ',
        body: `<p>ನೀವು ಗ್ರಾಹಕರಿಗೆ ಕೊಡುವ ಸಾಲಗಳ ಲೆಕ್ಕವನ್ನು ಈ ಆ್ಯಪ್ ಸಹಾಯದಿಂದ
          ಇಡಬಹುದು. ಪ್ರತಿಯೊಬ್ಬ ಗ್ರಾಹಕನ ಸಾಲದ ವಿವರ, ಕಂತುಗಳು ಮತ್ತು
          ಬಾಕಿ ದಂಡಗಳನ್ನು ದಾಖಲಿಸಿ. Dashboard ಇಂದು ಬಾಕಿ ಇರುವವರು
          ಮತ್ತು ಇತ್ತೀಚೆಗೆ ಕಂತು ತಪ್ಪಿಸಿದವರನ್ನು ತೋರಿಸುತ್ತದೆ. Portfolio
          ಪುಟ ನಿಮ್ಮ ಒಟ್ಟು ಸಾಲ ವ್ಯವಹಾರದ ಸಾರಾಂಶ ತೋರಿಸುತ್ತದೆ.</p>
          <p>ನಿಮ್ಮ ಎಲ್ಲಾ ಡೇಟಾ ನಿಮ್ಮ ಗಣಕದಲ್ಲಿ <b>finance.db</b> ಫೈಲ್‌ನಲ್ಲಿ
          ಸಂಗ್ರಹಿಸಲಾಗುತ್ತದೆ — ಇಂಟರ್ನೆಟ್‌ಗೆ ಏನೂ ಕಳುಹಿಸುವುದಿಲ್ಲ.</p>`,
      },
      {
        h: 'ತ್ವರಿತ ಬಳಕೆ ಕ್ರಮ',
        body: `<ul>
          <li><b>+ New Loan</b> → ಗ್ರಾಹಕ, ವಾಹನ, ಸಾಲದ ವಿವರ ತುಂಬಿ → Save ಒತ್ತಿ</li>
          <li>ಗ್ರಾಹಕನನ್ನು ತೆರೆಯಿರಿ → ಅವರು ಪಾವತಿಸಿದಾಗ <b>+ Add Payment</b></li>
          <li>ಗ್ರಾಹಕನನ್ನು ತೆರೆಯಿರಿ → ಬಾಕಿ ದಂಡಕ್ಕಾಗಿ <b>⚠ Add Penalty (O/D)</b></li>
          <li><b>Dashboard</b> ಇಂದು/ನಾಳೆ ಬಾಕಿ ಮತ್ತು ಇತ್ತೀಚೆಗೆ ತಪ್ಪಿಸಿದವರನ್ನು ತೋರಿಸುತ್ತದೆ</li>
          <li><b>Borrowers</b> ಪಟ್ಟಿಯಲ್ಲಿ ಬಾಕಿ ದಿನಗಳು ಅಥವಾ ಮೊತ್ತದ ಆಧಾರದ ಮೇಲೆ ಫಿಲ್ಟರ್</li>
          <li>ಸಾಲ ಸಂಪೂರ್ಣ ಪಾವತಿಯಾದಾಗ → ಗ್ರಾಹಕ ತೆರೆಯಿರಿ → <b>✔ Mark Closed</b></li>
        </ul>`,
      },
      {
        h: 'ಬಡ್ಡಿ ಲೆಕ್ಕಾಚಾರ ಹೇಗೆ',
        body: `<p>ಬಡ್ಡಿ ದರವನ್ನು <b>ವಾರ್ಷಿಕ</b> ಎಂದು ಪರಿಗಣಿಸಲಾಗುತ್ತದೆ, ಸಾಲದ
          ತಿಂಗಳುಗಳ ಅನುಪಾತದಲ್ಲಿ ಹಂಚಲಾಗುತ್ತದೆ:</p>
          <ul>
            <li>ಪರಿಣಾಮಕಾರಿ ದರ = ಬಡ್ಡಿ % × (ತಿಂಗಳುಗಳು ÷ 12)</li>
            <li>ಒಟ್ಟು ಪಾವತಿಸಬೇಕಾದದ್ದು = ಮೂಲಧನ × (1 + ಪರಿಣಾಮಕಾರಿ ದರ ÷ 100)</li>
            <li>ಮಾಸಿಕ ಕಂತು (EMI) = ಒಟ್ಟು ಪಾವತಿ ÷ ತಿಂಗಳುಗಳು</li>
          </ul>
          <p><b>ಉದಾಹರಣೆ:</b> ₹70,000, ವಾರ್ಷಿಕ 24%, 6 ತಿಂಗಳುಗಳಿಗೆ</p>
          <ul>
            <li>ಪರಿಣಾಮಕಾರಿ ದರ = 24% × (6 ÷ 12) = 12%</li>
            <li>ಒಟ್ಟು ಪಾವತಿ = 70,000 × 1.12 = ₹78,400</li>
            <li>ಮಾಸಿಕ ಕಂತು = 78,400 ÷ 6 = ₹13,067</li>
          </ul>`,
      },
      {
        h: 'ಸಾಲ ಫಾರ್ಮ್‌ನ ಕ್ಷೇತ್ರಗಳು',
        body: `<ul>
          <li><b>Principal Amount (ಮೂಲಧನ)</b> — ಗ್ರಾಹಕನಿಗೆ ಕೊಟ್ಟ ಹಣ</li>
          <li><b>Interest Rate (% per year)</b> — ವಾರ್ಷಿಕ ಬಡ್ಡಿ ದರ, ಸಾಮಾನ್ಯವಾಗಿ 24</li>
          <li><b>Period (months)</b> — ಎಷ್ಟು ತಿಂಗಳ ಸಾಲ</li>
          <li><b>Loan Date</b> — ಹಣ ಕೊಟ್ಟ ದಿನಾಂಕ. ಮುಂದಿನ ತಿಂಗಳುಗಳ ಅದೇ ದಿನಾಂಕದಂದು ಕಂತು ಬರುತ್ತದೆ.</li>
          <li><b>Total Payable</b> — ಸ್ವಯಂ ಲೆಕ್ಕ. ಮೂಲಧನ + ಒಟ್ಟು ಬಡ್ಡಿ.</li>
          <li><b>Monthly Installment (EMI)</b> — ಸ್ವಯಂ ಲೆಕ್ಕ. ಪ್ರತಿ ತಿಂಗಳು ಬರಬೇಕಾದದ್ದು. ಬೇಕಾದರೆ ನೀವೇ ಬದಲಿಸಬಹುದು.</li>
          <li><b>Book No / S.No</b> — ನಿಮ್ಮ ಪುಸ್ತಕ ರಿಜಿಸ್ಟರ್ ಸಂಖ್ಯೆ. ತುಂಬಿದರೆ ಅದು ಅನನ್ಯವಾಗಿರಬೇಕು. ಐಚ್ಛಿಕ.</li>
        </ul>`,
      },
      {
        h: 'ಸಾರಾಂಶ ಕ್ಷೇತ್ರಗಳು (ಗ್ರಾಹಕ ವಿವರದಲ್ಲಿ)',
        body: `<ul>
          <li><b>Paid So Far</b> — ಈ ಗ್ರಾಹಕನಿಂದ ಬಂದ ಎಲ್ಲ ಕಂತುಗಳ ಮೊತ್ತ</li>
          <li><b>Remaining</b> — ಒಟ್ಟು ಪಾವತಿ ಯಿಂದ ಪಾವತಿಯಾದ ಮೊತ್ತ ಕಡಿಮೆ. ಇನ್ನೂ ಎಷ್ಟು ಬಾಕಿ.</li>
          <li><b>Expected by Today</b> — ಇಂದಿನವರೆಗೆ ಎಷ್ಟು ಪಾವತಿಯಾಗಬೇಕಿತ್ತು
            (ಕಳೆದ ತಿಂಗಳುಗಳು × EMI). ಒಟ್ಟು ಪಾವತಿಗಿಂತ ಮೀರುವುದಿಲ್ಲ.</li>
          <li><b>Overdue Amount</b> — Expected by Today ಯಿಂದ Paid So Far ಕಡಿಮೆ.
            ಧನಾತ್ಮಕವಾಗಿದ್ದರೆ ಗ್ರಾಹಕ ಹಿಂದುಳಿದಿದ್ದಾನೆ.</li>
          <li><b>Days Overdue</b> — ಮೊದಲ ತಪ್ಪಿದ ಕಂತಿನ ದಿನಾಂಕದಿಂದ ಎಷ್ಟು ದಿನಗಳಾಗಿವೆ</li>
          <li><b>Months Elapsed</b> — ಸಾಲ ಕೊಟ್ಟ ದಿನದಿಂದ ಎಷ್ಟು ಪೂರ್ಣ ತಿಂಗಳುಗಳಾಗಿವೆ</li>
          <li><b>Penalties Paid</b> — ಒಟ್ಟು ಬಾಕಿ ದಂಡ (ಸಾಲದಿಂದ ಪ್ರತ್ಯೇಕವಾಗಿ ಲೆಕ್ಕ ಇಡಲಾಗುತ್ತದೆ)</li>
          <li><b>Last Payment</b> — ಕೊನೆಯ ಕಂತು ಬಂದ ದಿನಾಂಕ</li>
        </ul>`,
      },
      {
        h: 'ಸ್ಥಿತಿ ಲೇಬಲ್‌ಗಳು',
        body: `<ul>
          <li>🔴 <b>Overdue (ಬಾಕಿ)</b> — ಗ್ರಾಹಕ ನಿರೀಕ್ಷಿತಕ್ಕಿಂತ ಕಡಿಮೆ ಪಾವತಿಸಿದ್ದಾನೆ</li>
          <li>🟢 <b>On Time (ಸಮಯಕ್ಕೆ)</b> — ಸಮಯಕ್ಕೆ ಸರಿಯಾಗಿ ಪಾವತಿಸುತ್ತಿದ್ದಾನೆ, ಬಾಕಿ ಇಲ್ಲ</li>
          <li>🟢 <b>Advance (ಮುಂಗಡ)</b> — ನಿರೀಕ್ಷಿತಕ್ಕಿಂತ ಹೆಚ್ಚು ಪಾವತಿಸಿದ್ದಾನೆ (ಮುಂದಿದ್ದಾನೆ)</li>
          <li>⚪ <b>Closed (ಮುಗಿದಿದೆ)</b> — ಸಾಲ ಸಂಪೂರ್ಣ ಪಾವತಿಯಾಗಿ ಮುಚ್ಚಲ್ಪಟ್ಟಿದೆ</li>
        </ul>`,
      },
      {
        h: 'ಫಿಲ್ಟರ್ ಆಯ್ಕೆಗಳು (Borrowers ಪಟ್ಟಿ)',
        body: `<ul>
          <li><b>All Active</b> — ಪ್ರತಿ ಚಾಲನೆಯಲ್ಲಿರುವ ಸಾಲ</li>
          <li><b>Overdue (any)</b> — ಬಾಕಿ ಇರುವ ಯಾರಾದರೂ</li>
          <li><b>Overdue &gt; 1 / 2 / 3 ತಿಂಗಳುಗಳು</b> — 30 / 60 / 90+ ದಿನಗಳಿಂದ ಹಿಂದುಳಿದವರು</li>
          <li><b>Overdue &gt; ₹1,000 / ₹5,000</b> — ಬಾಕಿ ಮೊತ್ತದ ಆಧಾರದ ಮೇಲೆ</li>
          <li><b>Custom</b> — ನಿಮ್ಮದೇ ಮಿತಿಗಳನ್ನು ನೀಡಿ. ಯಾವುದಾದರೂ ಒಂದು ಷರತ್ತು ಪೂರೈಸಿದವರು ತೋರಿಸುತ್ತಾರೆ.</li>
          <li><b>Due Today / Tomorrow / 3 / 7 ದಿನಗಳು</b> — ಆ ಅವಧಿಯಲ್ಲಿ ಮುಂದಿನ ಕಂತು ಬರುತ್ತದೆ</li>
          <li><b>Pick Date</b> — ನಿರ್ದಿಷ್ಟ ದಿನಾಂಕದಂದು ಬಾಕಿ ಇರುವವರನ್ನು ತೋರಿಸಿ</li>
        </ul>`,
      },
      {
        h: 'ನಿಮ್ಮ ಡೇಟಾ ಬ್ಯಾಕಪ್',
        body: `<p>ನಿಮ್ಮ ಎಲ್ಲ ಡೇಟಾ <b>ಒಂದೇ ಫೈಲ್</b>ನಲ್ಲಿದೆ:
          <code>FinanceTracker.exe</code> ಪಕ್ಕದಲ್ಲಿ <code>finance.db</code>.</p>
          <p><b>ವಾರಕ್ಕೊಮ್ಮೆ ಬ್ಯಾಕಪ್:</b> ಆ್ಯಪ್ ಮುಚ್ಚಿ → <code>finance.db</code>
          ಅನ್ನು USB / Google Drive / OneDrive ಗೆ ಕಾಪಿ ಮಾಡಿ.</p>
          <p><b>ಹೊಸ ಗಣಕದಲ್ಲಿ ಮರುಸ್ಥಾಪಿಸಲು:</b> ಹೊಸ <code>FinanceTracker.exe</code> ಪಕ್ಕದಲ್ಲಿ
          ನಿಮ್ಮ <code>finance.db</code> ಇಟ್ಟು ಚಲಾಯಿಸಿ.</p>`,
      },
    ],
  },

  te: {
    title: 'సహాయం — Finance Tracker ఎలా పనిచేస్తుంది',
    subtitle: 'ఈ యాప్ ఉపయోగించడానికి సంక్షిప్త మార్గదర్శి',
    sections: [
      {
        h: 'ఈ యాప్ ఏం చేస్తుంది',
        body: `<p>మీరు రుణగ్రహీతలకు ఇచ్చే రుణాల వివరాలను ట్రాక్ చేయడానికి ఈ యాప్
          సహాయపడుతుంది. ప్రతి వ్యక్తి యొక్క రుణ వివరాలు, వారు చెల్లించే
          వాయిదాలు మరియు బకాయి జరిమానాలు రికార్డ్ చేయండి. Dashboard
          ఈరోజు ఎవరికి బకాయి ఉందో మరియు ఇటీవల ఎవరు చెల్లించలేదో
          చూపిస్తుంది. Portfolio పేజీ మీ పూర్తి రుణ వ్యవహారాన్ని సారాంశ
          రూపంలో చూపుతుంది.</p>
          <p>మీ డేటా అంతా మీ కంప్యూటర్‌లోని <b>finance.db</b> ఫైల్‌లో
          సురక్షితంగా ఉంటుంది — ఇంటర్నెట్‌కు ఏమీ పంపబడదు.</p>`,
      },
      {
        h: 'త్వరిత వాడుక విధానం',
        body: `<ul>
          <li><b>+ New Loan</b> → రుణగ్రహీత, వాహనం, రుణ వివరాలు నింపండి → Save</li>
          <li>రుణగ్రహీతను తెరవండి → వారు చెల్లించినప్పుడు <b>+ Add Payment</b></li>
          <li>రుణగ్రహీతను తెరవండి → బకాయి జరిమానా కోసం <b>⚠ Add Penalty (O/D)</b></li>
          <li><b>Dashboard</b> ఈరోజు/రేపు బకాయి మరియు ఇటీవల చెల్లించని వారిని చూపుతుంది</li>
          <li><b>Borrowers</b> జాబితాలో బకాయి రోజులు లేదా మొత్తం ఆధారంగా ఫిల్టర్ చేయండి</li>
          <li>రుణం పూర్తిగా చెల్లించబడినప్పుడు → రుణగ్రహీతను తెరిచి → <b>✔ Mark Closed</b></li>
        </ul>`,
      },
      {
        h: 'వడ్డీ ఎలా లెక్కిస్తారు',
        body: `<p>వడ్డీ రేటు <b>సంవత్సరానికి</b> అనుకుంటారు, రుణ నెలల ప్రకారం
          సర్దుబాటు చేయబడుతుంది:</p>
          <ul>
            <li>ప్రభావిత రేటు = వడ్డీ % × (నెలలు ÷ 12)</li>
            <li>మొత్తం చెల్లించాల్సినది = మూలధనం × (1 + ప్రభావిత రేటు ÷ 100)</li>
            <li>నెలవారీ వాయిదా (EMI) = మొత్తం చెల్లించాల్సినది ÷ నెలలు</li>
          </ul>
          <p><b>ఉదాహరణ:</b> ₹70,000, సంవత్సరానికి 24%, 6 నెలలకు</p>
          <ul>
            <li>ప్రభావిత రేటు = 24% × (6 ÷ 12) = 12%</li>
            <li>మొత్తం చెల్లించాల్సినది = 70,000 × 1.12 = ₹78,400</li>
            <li>నెలవారీ వాయిదా = 78,400 ÷ 6 = ₹13,067</li>
          </ul>`,
      },
      {
        h: 'రుణ ఫారం ఫీల్డ్‌లు',
        body: `<ul>
          <li><b>Principal Amount (మూలధనం)</b> — మీరు రుణగ్రహీతకు ఇచ్చిన డబ్బు</li>
          <li><b>Interest Rate (% per year)</b> — సంవత్సరానికి వడ్డీ రేటు, సాధారణంగా 24</li>
          <li><b>Period (months)</b> — రుణం ఎన్ని నెలలు ఉంటుంది</li>
          <li><b>Loan Date</b> — డబ్బు ఇచ్చిన తేదీ. తదుపరి నెలల అదే తేదీలో EMI బకాయి అవుతుంది.</li>
          <li><b>Total Payable</b> — ఆటోమేటిక్ లెక్క. మూలధనం + మొత్తం వడ్డీ.</li>
          <li><b>Monthly Installment (EMI)</b> — ఆటోమేటిక్ లెక్క. ప్రతి నెల చెల్లించాల్సినది. అవసరమైతే మీరే మార్చవచ్చు.</li>
          <li><b>Book No / S.No</b> — మీ భౌతిక రిజిస్టర్ నంబర్. నింపితే అది ప్రత్యేకంగా ఉండాలి. ఐచ్ఛికం.</li>
        </ul>`,
      },
      {
        h: 'సారాంశ ఫీల్డ్‌లు (రుణగ్రహీత వివరాలలో)',
        body: `<ul>
          <li><b>Paid So Far</b> — ఈ రుణగ్రహీత నుండి అందిన అన్ని వాయిదాల మొత్తం</li>
          <li><b>Remaining</b> — మొత్తం చెల్లించాల్సినది మైనస్ చెల్లించినది. ఇంకా ఎంత బకాయి.</li>
          <li><b>Expected by Today</b> — ఈరోజు వరకు ఎంత చెల్లించాలి
            (గడిచిన నెలలు × EMI). మొత్తం చెల్లించాల్సినదానిని మించదు.</li>
          <li><b>Overdue Amount</b> — Expected by Today మైనస్ Paid So Far.
            ధనాత్మకంగా ఉంటే రుణగ్రహీత వెనుకబడి ఉన్నాడు.</li>
          <li><b>Days Overdue</b> — మొదటి తప్పిన వాయిదా తేదీ నుండి ఎన్ని రోజులు</li>
          <li><b>Months Elapsed</b> — రుణం ఇచ్చిన తేదీ నుండి ఎన్ని పూర్తి నెలలు</li>
          <li><b>Penalties Paid</b> — మొత్తం బకాయి జరిమానా (రుణం నుండి విడిగా ఉంచబడుతుంది)</li>
          <li><b>Last Payment</b> — చివరి వాయిదా అందిన తేదీ</li>
        </ul>`,
      },
      {
        h: 'స్థితి లేబుళ్ళు',
        body: `<ul>
          <li>🔴 <b>Overdue (బకాయి)</b> — రుణగ్రహీత ఆశించిన దానికంటే తక్కువ చెల్లించాడు</li>
          <li>🟢 <b>On Time (సమయానికి)</b> — సరిగ్గా చెల్లిస్తున్నాడు, బకాయి లేదు</li>
          <li>🟢 <b>Advance (ముందుగా)</b> — ఆశించిన దానికంటే ఎక్కువ చెల్లించాడు</li>
          <li>⚪ <b>Closed (ముగిసింది)</b> — రుణం పూర్తిగా చెల్లించబడింది మరియు మూసివేయబడింది</li>
        </ul>`,
      },
      {
        h: 'ఫిల్టర్ ఎంపికలు (Borrowers జాబితా)',
        body: `<ul>
          <li><b>All Active</b> — ప్రతి జరుగుతున్న రుణం</li>
          <li><b>Overdue (any)</b> — బకాయి ఉన్న ఎవరైనా</li>
          <li><b>Overdue &gt; 1 / 2 / 3 నెలలు</b> — 30 / 60 / 90+ రోజుల నుండి వెనుకబడిన వారు</li>
          <li><b>Overdue &gt; ₹1,000 / ₹5,000</b> — బకాయి మొత్తం ఆధారంగా</li>
          <li><b>Custom</b> — మీ స్వంత పరిమితులు పెట్టండి. ఏదైనా ఒక షరతు తీర్చేవారు చూపబడతారు.</li>
          <li><b>Due Today / Tomorrow / 3 / 7 రోజులు</b> — ఆ వ్యవధిలో తదుపరి వాయిదా</li>
          <li><b>Pick Date</b> — నిర్దిష్ట తేదీలో బకాయి ఉన్నవారిని చూపండి</li>
        </ul>`,
      },
      {
        h: 'మీ డేటా బ్యాకప్',
        body: `<p>మీ డేటా అంతా <b>ఒకే ఫైల్‌లో</b> ఉంది:
          <code>FinanceTracker.exe</code> పక్కన <code>finance.db</code>.</p>
          <p><b>వారానికి ఒకసారి బ్యాకప్:</b> యాప్ మూసివేయండి → <code>finance.db</code>
          ను USB / Google Drive / OneDrive కు కాపీ చేయండి.</p>
          <p><b>కొత్త కంప్యూటర్‌లో పునరుద్ధరించడానికి:</b> కొత్త <code>FinanceTracker.exe</code> పక్కన
          మీ <code>finance.db</code> ఉంచి అమలు చేయండి.</p>`,
      },
    ],
  },

  ta: {
    title: 'உதவி — Finance Tracker எப்படி வேலை செய்கிறது',
    subtitle: 'இந்த ஆப்பை பயன்படுத்த சுருக்கமான வழிகாட்டி',
    sections: [
      {
        h: 'இந்த ஆப் என்ன செய்கிறது',
        body: `<p>நீங்கள் கடன் வாங்குபவர்களுக்கு கொடுக்கும் கடன்களை கணக்கிட
          இந்த ஆப் உதவுகிறது. ஒவ்வொரு நபரின் கடன் விவரங்கள், அவர்கள்
          செலுத்தும் தவணைகள் மற்றும் கடன் தாமத அபராதங்களை பதிவு செய்யுங்கள்.
          Dashboard இன்று கடன் கட்ட வேண்டியவர்கள் மற்றும் சமீபத்தில்
          தவணை தவறியவர்களை காட்டுகிறது. Portfolio பக்கம் உங்கள் முழு
          கடன் வியாபாரத்தின் சுருக்கத்தை காட்டுகிறது.</p>
          <p>உங்கள் எல்லா தரவும் உங்கள் கணினியில் உள்ள <b>finance.db</b>
          கோப்பில் பாதுகாப்பாக சேமிக்கப்படுகிறது — இணையத்திற்கு எதுவும் அனுப்பப்படாது.</p>`,
      },
      {
        h: 'விரைவான பயன்பாட்டு முறை',
        body: `<ul>
          <li><b>+ New Loan</b> → கடன் வாங்குபவர், வாகனம், கடன் விவரங்கள் நிரப்பவும் → Save</li>
          <li>கடன் வாங்குபவரை திறக்கவும் → அவர்கள் பணம் கட்டும்போது <b>+ Add Payment</b></li>
          <li>கடன் வாங்குபவரை திறக்கவும் → தாமத அபராதத்திற்கு <b>⚠ Add Penalty (O/D)</b></li>
          <li><b>Dashboard</b> இன்று/நாளை கட்ட வேண்டியவர்கள் மற்றும் சமீபத்தில் தவறியவர்களை காட்டுகிறது</li>
          <li><b>Borrowers</b> பட்டியலில் தாமத நாட்கள் அல்லது தொகை அடிப்படையில் வடிகட்டலாம்</li>
          <li>கடன் முழுவதும் கட்டப்பட்ட பிறகு → கடன் வாங்குபவரை திறக்கவும் → <b>✔ Mark Closed</b></li>
        </ul>`,
      },
      {
        h: 'வட்டி எப்படி கணக்கிடப்படுகிறது',
        body: `<p>வட்டி விகிதம் <b>ஆண்டுக்கு</b> எடுத்துக்கொள்ளப்படுகிறது, கடன்
          மாதங்களின் அடிப்படையில் பிரிக்கப்படுகிறது:</p>
          <ul>
            <li>உண்மையான விகிதம் = வட்டி % × (மாதங்கள் ÷ 12)</li>
            <li>மொத்த செலுத்த வேண்டியது = முதல் × (1 + உண்மையான விகிதம் ÷ 100)</li>
            <li>மாத தவணை (EMI) = மொத்த செலுத்த வேண்டியது ÷ மாதங்கள்</li>
          </ul>
          <p><b>உதாரணம்:</b> ₹70,000, ஆண்டுக்கு 24%, 6 மாதங்களுக்கு</p>
          <ul>
            <li>உண்மையான விகிதம் = 24% × (6 ÷ 12) = 12%</li>
            <li>மொத்த செலுத்த வேண்டியது = 70,000 × 1.12 = ₹78,400</li>
            <li>மாத தவணை = 78,400 ÷ 6 = ₹13,067</li>
          </ul>`,
      },
      {
        h: 'கடன் படிவத்தின் புலங்கள்',
        body: `<ul>
          <li><b>Principal Amount (முதல்)</b> — நீங்கள் கடன் வாங்குபவருக்கு கொடுத்த பணம்</li>
          <li><b>Interest Rate (% per year)</b> — ஆண்டு வட்டி விகிதம், பொதுவாக 24</li>
          <li><b>Period (months)</b> — கடன் எத்தனை மாதங்களுக்கு</li>
          <li><b>Loan Date</b> — பணம் கொடுத்த தேதி. அடுத்த மாதங்களின் அதே தேதியில் EMI கட்ட வேண்டும்.</li>
          <li><b>Total Payable</b> — தானாகவே கணக்கிடப்படுகிறது. முதல் + மொத்த வட்டி.</li>
          <li><b>Monthly Installment (EMI)</b> — தானாகவே கணக்கிடப்படுகிறது. ஒவ்வொரு மாதமும் கட்ட வேண்டியது. தேவைப்பட்டால் நீங்களே மாற்றலாம்.</li>
          <li><b>Book No / S.No</b> — உங்கள் பதிவேட்டின் எண். நிரப்பினால் அது தனித்துவமாக இருக்க வேண்டும். விருப்பத்தேர்வு.</li>
        </ul>`,
      },
      {
        h: 'சுருக்க புலங்கள் (கடன் வாங்குபவர் விவரத்தில்)',
        body: `<ul>
          <li><b>Paid So Far</b> — இந்த கடன் வாங்குபவரிடமிருந்து பெறப்பட்ட அனைத்து தவணைகளின் கூட்டுத்தொகை</li>
          <li><b>Remaining</b> — மொத்த செலுத்த வேண்டியது மைனஸ் கட்டியது. மீதம் எவ்வளவு கட்ட வேண்டும்.</li>
          <li><b>Expected by Today</b> — இன்று வரை எவ்வளவு கட்ட வேண்டும்
            (கடந்த மாதங்கள் × EMI). மொத்தம் கட்ட வேண்டியதை மீறாது.</li>
          <li><b>Overdue Amount</b> — Expected by Today மைனஸ் Paid So Far.
            நேர்மறையாக இருந்தால் கடன் வாங்குபவர் பின் தங்கியிருக்கிறார்.</li>
          <li><b>Days Overdue</b> — முதல் தவறிய தவணையின் தேதியிலிருந்து எத்தனை நாட்கள்</li>
          <li><b>Months Elapsed</b> — கடன் கொடுத்த தேதியிலிருந்து எத்தனை முழு மாதங்கள்</li>
          <li><b>Penalties Paid</b> — மொத்த தாமத அபராதம் (கடனிலிருந்து தனியாக வைக்கப்படுகிறது)</li>
          <li><b>Last Payment</b> — கடைசி தவணை பெறப்பட்ட தேதி</li>
        </ul>`,
      },
      {
        h: 'நிலை லேபிள்கள்',
        body: `<ul>
          <li>🔴 <b>Overdue (தாமதம்)</b> — கடன் வாங்குபவர் எதிர்பார்த்ததை விட குறைவாக கட்டியுள்ளார்</li>
          <li>🟢 <b>On Time (சரியான நேரத்தில்)</b> — சரியாக கட்டிக்கொண்டிருக்கிறார், தாமதம் இல்லை</li>
          <li>🟢 <b>Advance (முன்பணம்)</b> — எதிர்பார்த்ததை விட அதிகமாக கட்டியுள்ளார்</li>
          <li>⚪ <b>Closed (முடிந்தது)</b> — கடன் முழுவதும் கட்டப்பட்டு மூடப்பட்டது</li>
        </ul>`,
      },
      {
        h: 'வடிகட்டி விருப்பங்கள் (Borrowers பட்டியல்)',
        body: `<ul>
          <li><b>All Active</b> — ஒவ்வொரு நடப்பு கடன்</li>
          <li><b>Overdue (any)</b> — தாமதமாக உள்ள எவராலும்</li>
          <li><b>Overdue &gt; 1 / 2 / 3 மாதங்கள்</b> — 30 / 60 / 90+ நாட்களாக பின் தங்கியவர்கள்</li>
          <li><b>Overdue &gt; ₹1,000 / ₹5,000</b> — தாமத தொகை அடிப்படையில்</li>
          <li><b>Custom</b> — உங்கள் சொந்த வரம்புகளை அமைக்கவும். ஏதேனும் ஒரு நிபந்தனை பூர்த்தி செய்தவர்கள் காட்டப்படுவார்கள்.</li>
          <li><b>Due Today / Tomorrow / 3 / 7 நாட்கள்</b> — அந்த காலகட்டத்தில் அடுத்த தவணை</li>
          <li><b>Pick Date</b> — குறிப்பிட்ட தேதியில் கட்ட வேண்டியவர்களை காட்டுங்கள்</li>
        </ul>`,
      },
      {
        h: 'உங்கள் தரவை காப்புப்பிரதி எடுக்கவும்',
        body: `<p>உங்கள் எல்லா தரவும் <b>ஒரே கோப்பில்</b> உள்ளது:
          <code>FinanceTracker.exe</code> அருகில் <code>finance.db</code>.</p>
          <p><b>வாரத்திற்கு ஒருமுறை காப்புப்பிரதி:</b> ஆப்பை மூடவும் → <code>finance.db</code>
          ஐ USB / Google Drive / OneDrive க்கு நகலெடுக்கவும்.</p>
          <p><b>புதிய கணினியில் மீட்டெடுக்க:</b> புதிய <code>FinanceTracker.exe</code> அருகில்
          உங்கள் <code>finance.db</code> ஐ வைத்து இயக்கவும்.</p>`,
      },
    ],
  },

  ml: {
    title: 'സഹായം — Finance Tracker എങ്ങനെ പ്രവർത്തിക്കുന്നു',
    subtitle: 'ഈ ആപ്പ് ഉപയോഗിക്കാനുള്ള ഹ്രസ്വ വഴികാട്ടി',
    sections: [
      {
        h: 'ഈ ആപ്പ് എന്ത് ചെയ്യുന്നു',
        body: `<p>നിങ്ങൾ ഉപഭോക്താക്കൾക്ക് നൽകുന്ന വായ്പകൾ ട്രാക്ക് ചെയ്യാൻ
          ഈ ആപ്പ് സഹായിക്കുന്നു. ഓരോ വ്യക്തിയുടെയും വായ്പ വിശദാംശങ്ങൾ,
          അവർ അടയ്ക്കുന്ന ഗഡുക്കൾ, കുടിശ്ശിക പിഴകൾ എന്നിവ രേഖപ്പെടുത്തുക.
          Dashboard ഇന്ന് അടയ്ക്കേണ്ടവരെയും അടുത്തിടെ അടവ് മുടക്കിയവരെയും
          കാണിക്കുന്നു. Portfolio പേജ് നിങ്ങളുടെ മുഴുവൻ വായ്പ ഇടപാടിന്റെ
          സംഗ്രഹം നൽകുന്നു.</p>
          <p>നിങ്ങളുടെ എല്ലാ ഡാറ്റയും നിങ്ങളുടെ കമ്പ്യൂട്ടറിലെ <b>finance.db</b>
          ഫയലിൽ സുരക്ഷിതമായി സൂക്ഷിക്കുന്നു — ഇന്റർനെറ്റിലേക്ക് ഒന്നും അയയ്ക്കുന്നില്ല.</p>`,
      },
      {
        h: 'പെട്ടെന്നുള്ള ഉപയോഗ രീതി',
        body: `<ul>
          <li><b>+ New Loan</b> → ഉപഭോക്താവ്, വാഹനം, വായ്പ വിശദാംശങ്ങൾ പൂരിപ്പിക്കുക → Save</li>
          <li>ഉപഭോക്താവിനെ തുറക്കുക → അവർ പണം അടയ്ക്കുമ്പോൾ <b>+ Add Payment</b></li>
          <li>ഉപഭോക്താവിനെ തുറക്കുക → കുടിശ്ശിക പിഴയ്ക്ക് <b>⚠ Add Penalty (O/D)</b></li>
          <li><b>Dashboard</b> ഇന്ന്/നാളെ അടയ്ക്കേണ്ടവരെയും അടുത്തിടെ മുടക്കിയവരെയും കാണിക്കുന്നു</li>
          <li><b>Borrowers</b> ലിസ്റ്റിൽ കുടിശ്ശിക ദിവസങ്ങൾ അല്ലെങ്കിൽ തുക അനുസരിച്ച് ഫിൽട്ടർ ചെയ്യാം</li>
          <li>വായ്പ പൂർണ്ണമായി അടച്ചപ്പോൾ → ഉപഭോക്താവിനെ തുറന്ന് → <b>✔ Mark Closed</b></li>
        </ul>`,
      },
      {
        h: 'പലിശ എങ്ങനെ കണക്കാക്കുന്നു',
        body: `<p>പലിശ നിരക്ക് <b>വാർഷികമായി</b> പരിഗണിക്കുന്നു, വായ്പ
          മാസങ്ങൾക്കനുസരിച്ച് ആനുപാതികമായി വിഭജിക്കുന്നു:</p>
          <ul>
            <li>പ്രവർത്തന നിരക്ക് = പലിശ % × (മാസങ്ങൾ ÷ 12)</li>
            <li>മൊത്തം അടയ്ക്കേണ്ടത് = മൂലധനം × (1 + പ്രവർത്തന നിരക്ക് ÷ 100)</li>
            <li>മാസ ഗഡു (EMI) = മൊത്തം അടയ്ക്കേണ്ടത് ÷ മാസങ്ങൾ</li>
          </ul>
          <p><b>ഉദാഹരണം:</b> ₹70,000, വാർഷികം 24%, 6 മാസത്തേക്ക്</p>
          <ul>
            <li>പ്രവർത്തന നിരക്ക് = 24% × (6 ÷ 12) = 12%</li>
            <li>മൊത്തം അടയ്ക്കേണ്ടത് = 70,000 × 1.12 = ₹78,400</li>
            <li>മാസ ഗഡു = 78,400 ÷ 6 = ₹13,067</li>
          </ul>`,
      },
      {
        h: 'വായ്പ ഫോമിലെ ഫീൽഡുകൾ',
        body: `<ul>
          <li><b>Principal Amount (മൂലധനം)</b> — നിങ്ങൾ ഉപഭോക്താവിന് നൽകിയ പണം</li>
          <li><b>Interest Rate (% per year)</b> — വാർഷിക പലിശ നിരക്ക്, സാധാരണ 24</li>
          <li><b>Period (months)</b> — വായ്പ എത്ര മാസത്തേക്ക്</li>
          <li><b>Loan Date</b> — പണം നൽകിയ തീയതി. അടുത്ത മാസങ്ങളിലെ അതേ തീയതിയിൽ EMI അടയ്ക്കണം.</li>
          <li><b>Total Payable</b> — സ്വയം കണക്കാക്കുന്നു. മൂലധനം + മൊത്തം പലിശ.</li>
          <li><b>Monthly Installment (EMI)</b> — സ്വയം കണക്കാക്കുന്നു. ഓരോ മാസവും അടയ്ക്കേണ്ടത്. ആവശ്യമെങ്കിൽ നിങ്ങൾക്ക് മാറ്റാം.</li>
          <li><b>Book No / S.No</b> — നിങ്ങളുടെ രജിസ്റ്റർ നമ്പർ. പൂരിപ്പിച്ചാൽ അത് അദ്വിതീയമായിരിക്കണം. ഓപ്ഷണൽ.</li>
        </ul>`,
      },
      {
        h: 'സംഗ്രഹ ഫീൽഡുകൾ (ഉപഭോക്തൃ വിശദാംശത്തിൽ)',
        body: `<ul>
          <li><b>Paid So Far</b> — ഈ ഉപഭോക്താവിൽ നിന്ന് ലഭിച്ച എല്ലാ ഗഡുക്കളുടെയും ആകെത്തുക</li>
          <li><b>Remaining</b> — മൊത്തം അടയ്ക്കേണ്ടത് മൈനസ് അടച്ചത്. ഇനി എത്ര ബാക്കി.</li>
          <li><b>Expected by Today</b> — ഇന്നുവരെ എത്ര അടയ്ക്കണമായിരുന്നു
            (കഴിഞ്ഞ മാസങ്ങൾ × EMI). മൊത്തം അടയ്ക്കേണ്ടതിൽ കൂടാത്തത്.</li>
          <li><b>Overdue Amount</b> — Expected by Today മൈനസ് Paid So Far.
            പോസിറ്റീവ് ആണെങ്കിൽ ഉപഭോക്താവ് പിന്നിലാണ്.</li>
          <li><b>Days Overdue</b> — ആദ്യം മുടക്കിയ ഗഡുവിന്റെ തീയതി മുതൽ എത്ര ദിവസം</li>
          <li><b>Months Elapsed</b> — വായ്പ നൽകിയ തീയതി മുതൽ എത്ര പൂർണ മാസങ്ങൾ</li>
          <li><b>Penalties Paid</b> — മൊത്തം കുടിശ്ശിക പിഴ (വായ്പയിൽ നിന്ന് വേറെ സൂക്ഷിക്കുന്നു)</li>
          <li><b>Last Payment</b> — അവസാന ഗഡു ലഭിച്ച തീയതി</li>
        </ul>`,
      },
      {
        h: 'സ്റ്റാറ്റസ് ലേബലുകൾ',
        body: `<ul>
          <li>🔴 <b>Overdue (കുടിശ്ശിക)</b> — ഉപഭോക്താവ് പ്രതീക്ഷിച്ചതിലും കുറവ് അടച്ചു</li>
          <li>🟢 <b>On Time (സമയത്ത്)</b> — ശരിയായ സമയത്ത് അടയ്ക്കുന്നു, കുടിശ്ശിക ഇല്ല</li>
          <li>🟢 <b>Advance (മുൻകൂട്ടി)</b> — പ്രതീക്ഷിച്ചതിലും കൂടുതൽ അടച്ചു</li>
          <li>⚪ <b>Closed (അവസാനിച്ചു)</b> — വായ്പ പൂർണ്ണമായി അടച്ച് അവസാനിപ്പിച്ചു</li>
        </ul>`,
      },
      {
        h: 'ഫിൽട്ടർ ഓപ്ഷനുകൾ (Borrowers ലിസ്റ്റ്)',
        body: `<ul>
          <li><b>All Active</b> — ഓരോ നടന്നുകൊണ്ടിരിക്കുന്ന വായ്പ</li>
          <li><b>Overdue (any)</b> — കുടിശ്ശികയുള്ള ആരെങ്കിലും</li>
          <li><b>Overdue &gt; 1 / 2 / 3 മാസം</b> — 30 / 60 / 90+ ദിവസമായി പിന്നിലുള്ളവർ</li>
          <li><b>Overdue &gt; ₹1,000 / ₹5,000</b> — കുടിശ്ശിക തുകയനുസരിച്ച്</li>
          <li><b>Custom</b> — സ്വന്തം പരിധികൾ വയ്ക്കുക. ഏതെങ്കിലുമൊരു വ്യവസ്ഥ പാലിക്കുന്നവർ കാണിക്കും.</li>
          <li><b>Due Today / Tomorrow / 3 / 7 ദിവസം</b> — ആ കാലയളവിൽ അടുത്ത ഗഡു</li>
          <li><b>Pick Date</b> — ഒരു പ്രത്യേക തീയതിയിൽ അടയ്ക്കേണ്ടവരെ കാണിക്കുക</li>
        </ul>`,
      },
      {
        h: 'നിങ്ങളുടെ ഡാറ്റ ബാക്കപ്പ് ചെയ്യുക',
        body: `<p>നിങ്ങളുടെ എല്ലാ ഡാറ്റയും <b>ഒരൊറ്റ ഫയലിലാണ്</b>:
          <code>FinanceTracker.exe</code> ന്റെ അടുത്ത് <code>finance.db</code>.</p>
          <p><b>ആഴ്ചയിൽ ഒരിക്കൽ ബാക്കപ്പ്:</b> ആപ്പ് അടയ്ക്കുക → <code>finance.db</code>
          ഫയൽ USB / Google Drive / OneDrive ലേക്ക് കോപ്പി ചെയ്യുക.</p>
          <p><b>പുതിയ കമ്പ്യൂട്ടറിൽ പുനഃസ്ഥാപിക്കാൻ:</b> പുതിയ <code>FinanceTracker.exe</code> അരികിൽ
          നിങ്ങളുടെ <code>finance.db</code> വച്ച് റൺ ചെയ്യുക.</p>`,
      },
    ],
  },

  mr: {
    title: 'मदत — Finance Tracker कसे काम करते',
    subtitle: 'हे अॅप वापरण्यासाठी संक्षिप्त मार्गदर्शक',
    sections: [
      {
        h: 'हे अॅप काय करते',
        body: `<p>तुम्ही ग्राहकांना दिलेली कर्जे ट्रॅक करण्यासाठी हे अॅप मदत करते.
          प्रत्येक व्यक्तीचे कर्ज तपशील, त्यांनी भरलेले हप्ते, आणि थकीत दंड नोंदवा.
          Dashboard आज देय असलेले आणि अलीकडे हप्ता न भरलेले ग्राहक दाखवतो.
          Portfolio पान तुमच्या एकूण कर्ज व्यवहाराचे सारांश दाखवते.</p>
          <p>तुमचा सर्व डेटा तुमच्या संगणकावरील <b>finance.db</b> फाइलमध्ये
          सुरक्षित ठेवला जातो — इंटरनेटवर काहीही पाठवले जात नाही.</p>`,
      },
      {
        h: 'जलद वापर पद्धत',
        body: `<ul>
          <li><b>+ New Loan</b> → ग्राहक, वाहन, कर्ज तपशील भरा → Save</li>
          <li>ग्राहक उघडा → ते पैसे भरतात तेव्हा <b>+ Add Payment</b></li>
          <li>ग्राहक उघडा → थकीत दंडासाठी <b>⚠ Add Penalty (O/D)</b></li>
          <li><b>Dashboard</b> आज/उद्या देय आणि अलीकडे हप्ता चुकलेले दाखवतो</li>
          <li><b>Borrowers</b> यादीत थकीत दिवस किंवा रकमेनुसार फिल्टर करा</li>
          <li>कर्ज पूर्ण फिटले की → ग्राहक उघडा → <b>✔ Mark Closed</b></li>
        </ul>`,
      },
      {
        h: 'व्याज कसे मोजले जाते',
        body: `<p>व्याज दर <b>वार्षिक</b> मानला जातो, कर्जाच्या महिन्यांनुसार प्रमाणानुसार
          विभागला जातो:</p>
          <ul>
            <li>परिणामकारी दर = व्याज % × (महिने ÷ 12)</li>
            <li>एकूण देय = मूळ रक्कम × (1 + परिणामकारी दर ÷ 100)</li>
            <li>मासिक हप्ता (EMI) = एकूण देय ÷ महिने</li>
          </ul>
          <p><b>उदाहरण:</b> ₹70,000, वार्षिक 24%, 6 महिन्यांसाठी</p>
          <ul>
            <li>परिणामकारी दर = 24% × (6 ÷ 12) = 12%</li>
            <li>एकूण देय = 70,000 × 1.12 = ₹78,400</li>
            <li>मासिक हप्ता = 78,400 ÷ 6 = ₹13,067</li>
          </ul>`,
      },
      {
        h: 'कर्ज फॉर्मचे फील्ड',
        body: `<ul>
          <li><b>Principal Amount (मूळ रक्कम)</b> — तुम्ही ग्राहकाला दिलेली रक्कम</li>
          <li><b>Interest Rate (% per year)</b> — वार्षिक व्याज दर, सामान्यतः 24</li>
          <li><b>Period (months)</b> — कर्ज किती महिन्यांसाठी आहे</li>
          <li><b>Loan Date</b> — पैसे दिल्याची तारीख. पुढील महिन्यांच्या त्याच तारखेला EMI देय होतो.</li>
          <li><b>Total Payable</b> — आपोआप मोजले जाते. मूळ रक्कम + एकूण व्याज.</li>
          <li><b>Monthly Installment (EMI)</b> — आपोआप मोजले जाते. प्रत्येक महिन्याची देय रक्कम. गरज असल्यास बदलू शकता.</li>
          <li><b>Book No / S.No</b> — तुमचा नोंदवही क्रमांक. भरला तर तो अद्वितीय असावा. ऐच्छिक.</li>
        </ul>`,
      },
      {
        h: 'सारांश फील्ड (ग्राहक तपशिलात)',
        body: `<ul>
          <li><b>Paid So Far</b> — या ग्राहकाकडून मिळालेल्या सर्व हप्त्यांची बेरीज</li>
          <li><b>Remaining</b> — एकूण देय वजा भरलेली रक्कम. अजून किती देणे आहे.</li>
          <li><b>Expected by Today</b> — आजपर्यंत किती भरायला हवे होते
            (उलटलेले महिने × EMI). एकूण देयापेक्षा जास्त नसते.</li>
          <li><b>Overdue Amount</b> — Expected by Today वजा Paid So Far.
            सकारात्मक असल्यास ग्राहक मागे आहे.</li>
          <li><b>Days Overdue</b> — पहिल्या चुकलेल्या हप्त्याच्या तारखेपासून किती दिवस</li>
          <li><b>Months Elapsed</b> — कर्ज दिल्याच्या तारखेपासून किती पूर्ण महिने</li>
          <li><b>Penalties Paid</b> — एकूण थकीत दंड (कर्जापासून वेगळा ठेवला जातो)</li>
          <li><b>Last Payment</b> — शेवटचा हप्ता मिळाल्याची तारीख</li>
        </ul>`,
      },
      {
        h: 'स्थिती लेबल्स',
        body: `<ul>
          <li>🔴 <b>Overdue (थकीत)</b> — ग्राहकाने अपेक्षेपेक्षा कमी भरले आहे</li>
          <li>🟢 <b>On Time (वेळेत)</b> — वेळेवर भरत आहे, काहीही थकीत नाही</li>
          <li>🟢 <b>Advance (आगाऊ)</b> — अपेक्षेपेक्षा जास्त भरले आहे</li>
          <li>⚪ <b>Closed (बंद)</b> — कर्ज पूर्ण फिटले आणि बंद केले</li>
        </ul>`,
      },
      {
        h: 'फिल्टर पर्याय (Borrowers यादी)',
        body: `<ul>
          <li><b>All Active</b> — प्रत्येक चालू कर्ज</li>
          <li><b>Overdue (any)</b> — थकीत असलेला कोणताही</li>
          <li><b>Overdue &gt; 1 / 2 / 3 महिने</b> — 30 / 60 / 90+ दिवसांपासून मागे असलेले</li>
          <li><b>Overdue &gt; ₹1,000 / ₹5,000</b> — थकीत रकमेनुसार</li>
          <li><b>Custom</b> — स्वतःच्या मर्यादा लावा. कोणतीही एक अट पूर्ण करणारे दाखवले जातात.</li>
          <li><b>Due Today / Tomorrow / 3 / 7 दिवस</b> — त्या कालावधीत पुढील हप्ता</li>
          <li><b>Pick Date</b> — विशिष्ट तारखेला देय असलेले दाखवा</li>
        </ul>`,
      },
      {
        h: 'तुमचा डेटा बॅकअप घ्या',
        body: `<p>तुमचा सर्व डेटा <b>एकाच फाइलमध्ये</b> आहे:
          <code>FinanceTracker.exe</code> शेजारी <code>finance.db</code>.</p>
          <p><b>आठवड्यातून एकदा बॅकअप:</b> अॅप बंद करा → <code>finance.db</code>
          USB / Google Drive / OneDrive वर कॉपी करा.</p>
          <p><b>नवीन संगणकावर पुनर्संचयित करण्यासाठी:</b> नवीन <code>FinanceTracker.exe</code> शेजारी
          तुमची <code>finance.db</code> ठेवा आणि चालवा.</p>`,
      },
    ],
  },
};
