"""
Seed 50 realistic fake borrowers for demo.
Safe to re-run — skips if already seeded.
Run: py seed_fake.py
"""
import db
from models import _add_months, parse_date
from datetime import date

TODAY = date(2026, 5, 19)

def emi(p, n):
    return round(p * 1.24 / n)

def add_pays(bid, ld, inst, count):
    ldate = parse_date(ld)
    for i in range(1, count + 1):
        pd = _add_months(ldate, i)
        if pd > TODAY:
            break
        db.add_payment(bid, pd.strftime('%Y-%m-%d'), inst,
                       receipt_no=str(7000 + bid * 15 + i),
                       installment_label=str(i))

def add_b(name, father, addr, phone, gn, gp, ga, vt, vno, eng, chas,
          key, sno, bref, showroom, loan, period, ldate, pay,
          closed=False, advance=0):
    inst = emi(loan, period)
    bid = db.add_borrower({
        'name': name, 'father_name': father, 'address': addr,
        'phone': phone, 'guarantor_name': gn, 'guarantor_phone': gp,
        'guarantor_address': ga, 'vehicle_type': vt, 'vehicle_no': vno,
        'engine_no': eng, 'chassis_no': chas, 'key_no': key,
        'serial_no': sno, 'book_ref': bref, 'showroom': showroom,
        'loan_amount': loan, 'interest_rate': 24.0,
        'period_months': period, 'installment_amount': inst,
        'loan_date': ldate, 'notes': '', 'closed': 0,
    })
    add_pays(bid, ldate, inst, pay)
    if advance > 0:
        adv_date = _add_months(parse_date(ldate), pay)
        if adv_date > TODAY:
            adv_date = TODAY
        db.add_payment(bid, adv_date.strftime('%Y-%m-%d'), advance,
                       receipt_no=f'ADV{bid}', installment_label='Advance',
                       notes='Advance payment')
    if closed:
        db.update_borrower(bid, {'closed': 1})


def seed():
    db.init_db()
    existing = db.list_borrowers()
    if len(existing) >= 10:
        print(f"Already {len(existing)} borrowers. Skipping.")
        print("Delete finance.db and run again to reseed from scratch.")
        return

    # ── OVERDUE (15) — paid less than expected ───────────────
    # All are 12-month loans started 2024, so full 12 EMIs are expected by now.
    # Varying how many they actually paid.

    add_b('Rajesh Gowda', 'Thimmaiah', 'Kamasamudra (V), C.N.Halli (P), Challakere (T)',
          '9880101010', 'Suresh Naik', '9902020202', 'Hiriyur (T)',
          'Auto', 'KA-16-AC-1234', '61201', 'B1201', '2201', 'M-201', 'Book-1/M-201',
          'Indian Motors', 75000, 12, '2024-06-10', 6)

    add_b('Suresh Reddy', 'Venkataramaiah', 'Kunikere (V), Hiriyur (T)',
          '9901212121', 'Raju Patil', '9880232323', 'Hiriyur',
          'Auto', 'KA-17-AB-2345', '61202', 'B1202', '2202', 'M-202', 'Book-1/M-202',
          'Sai Agencies', 50000, 12, '2024-08-20', 5)

    add_b('Nagaraj Naik', 'Basavaiah', 'Bharamasagara (V), Challakere (T)',
          '7760303030', 'Lingaiah Gowda', '8088343434', 'Challakere',
          'Mini Truck', 'KA-16-EZ-3456', '61203', 'B1203', '2203', 'M-203', 'Book-1/M-203',
          'Sri Ram Motors', 100000, 12, '2024-04-05', 8)

    add_b('Basavaraj Patil', 'Hanumaiah', 'Ramajogihalli (V), Holalkere (T)',
          '8088404040', 'Thimmaiah Naik', '9901454545', 'Holalkere',
          'Auto', 'KA-15-BC-4567', '61204', 'B1204', '2204', 'M-204', 'Book-1/M-204',
          'Divya Motors', 80000, 12, '2024-11-15', 5)

    add_b('Krishnappa Hegde', 'Muniyappa', 'Joladal (V), Challakere (T)',
          '9739505050', 'Siddaiah Rao', '7760565656', 'Challakere',
          'Auto', 'KA-16-BK-5678', '61205', 'B1205', '2205', 'M-205', 'Book-1/M-205',
          'Indian Motors', 60000, 18, '2025-01-10', 12)   # 18-month loan, expected=16, paid=12

    add_b('Hanumanthappa Rao', 'Shivaramu', 'Neeralgi (V), Hiriyur (T)',
          '9880606060', 'Rajappa Setty', '9901676767', 'Hiriyur',
          'Auto', 'KA-17-GK-6789', '61206', 'B1206', '2206', 'M-206', 'Book-1/M-206',
          'Laxmi Motors', 90000, 12, '2024-07-25', 6)

    add_b('Shivaraj Setty', 'Lakshmaiah', 'Gollarahatti (V), Hosadurga (T)',
          '7760707070', 'Gangaiah Kumar', '8088787878', 'Hosadurga',
          'Auto', 'KA-13-HJ-7890', '61207', 'B1207', '2207', 'M-207', 'Book-2/M-207',
          'Sri Ram Motors', 75000, 12, '2025-02-14', 8)

    add_b('Manjunath Kumar', 'Narasimhaiah', 'Nerale (V), Challakere (T)',
          '8088808080', 'Krishnappa Raju', '9739898989', 'Challakere',
          'Auto', 'KA-14-EZ-8901', '61208', 'B1208', '2208', 'M-208', 'Book-2/M-208',
          'Sai Agencies', 50000, 12, '2024-09-01', 5)

    add_b('Siddesh Nayak', 'Rangaiah', 'Maradihalli (V), Chitradurga (T)',
          '9901909090', 'Boraiah Swamy', '7760919191', 'Chitradurga',
          'Auto', 'KA-16-AC-9012', '61209', 'B1209', '2209', 'M-209', 'Book-2/M-209',
          'Indian Motors', 60000, 12, '2025-03-20', 7)

    add_b('Prabhakar Murthy', 'Krishnaiah', 'Ajjampura (V), Holalkere (T)',
          '9880001001', 'Thippeswamy Naik', '9901002002', 'Holalkere',
          'Auto', 'KA-16-AB-0123', '61210', 'B1210', '2210', 'M-210', 'Book-2/M-210',
          'Divya Motors', 80000, 12, '2024-12-05', 9)

    add_b('Govinda Raju', 'Ramaiah', 'Parashurampura (V), Challakere (T)',
          '7760003003', 'Mallaiah Gowda', '8088004004', 'Challakere',
          'Mini Truck', 'KA-17-BC-1234', '61211', 'B1211', '2211', 'M-211', 'Book-2/M-211',
          'Sri Ram Motors', 120000, 18, '2025-04-12', 9)  # 18-month, expected=13, paid=9

    add_b('Mahesh Achar', 'Thimmaiah Gowda', 'Kunikere (V), Challakere (T)',
          '8088005005', 'Srinivasa Rao', '9739006006', 'Challakere',
          'Auto', 'KA-16-EZ-2222', '61212', 'B1212', '2212', 'M-212', 'Book-2/M-212',
          'Indian Motors', 50000, 12, '2024-10-08', 7)

    add_b('Girish Nayak', 'Venkataramaiah', 'Kamasamudra (V), Challakere (T)',
          '9901007007', 'Halappa Reddy', '7760008008', 'Molakalmuru',
          'Auto', 'KA-15-BK-3333', '61213', 'B1213', '2213', 'M-213', 'Book-3/M-213',
          'Laxmi Motors', 75000, 12, '2025-05-10', 8)

    add_b('Santosh Sharma', 'Basavaiah', 'Hiriyur (T)',
          '9880009009', 'Channappa Patil', '9901010010', 'Hiriyur',
          'Tractor', 'KA-17-HJ-4444', '61214', 'B1214', '2214', 'M-214', 'Book-3/M-214',
          'Sai Agencies', 150000, 24, '2024-03-25', 20)  # 24-month, expected=24, paid=20

    add_b('Dinesh Patil', 'Hanumaiah', 'Holalkere (T)',
          '7760011011', 'Siddaraju Gowda', '8088012012', 'Holalkere',
          'Auto', 'KA-16-GK-5555', '61215', 'B1215', '2215', 'M-215', 'Book-3/M-215',
          'Divya Motors', 60000, 12, '2025-06-18', 7)

    # ── ON TIME (12) — paid exactly what's expected ──────────
    add_b('Kiran Kumar', 'Lakshmaiah', 'Challakere (T)',
          '9739013013', 'Ravi Hegde', '9880014014', 'Challakere',
          'Auto', 'KA-16-AC-6001', '61216', 'B1216', '2216', 'M-216', 'Book-3/M-216',
          'Indian Motors', 75000, 12, '2025-07-10', 10)

    add_b('Sunil Gowda', 'Narasimhaiah', 'Bharamasagara (V), Challakere (T)',
          '9901015015', 'Umesh Naik', '7760016016', 'Challakere',
          'Auto', 'KA-17-AB-6002', '61217', 'B1217', '2217', 'M-217', 'Book-3/M-217',
          'Sri Ram Motors', 50000, 12, '2025-08-15', 9)

    add_b('Naveen Reddy', 'Shivaramu', 'Ramajogihalli (V), Holalkere (T)',
          '8088017017', 'Prasad Murthy', '9739018018', 'Holalkere',
          'Auto', 'KA-16-BC-6003', '61218', 'B1218', '2218', 'M-218', 'Book-3/M-218',
          'Laxmi Motors', 80000, 12, '2025-09-05', 8)

    add_b('Deepak Naik', 'Rangaiah', 'Joladal (V), Challakere (T)',
          '9880019019', 'Veeraiah Setty', '9901020020', 'Challakere',
          'Auto', 'KA-15-EZ-6004', '61219', 'B1219', '2219', 'M-219', 'Book-4/M-219',
          'Sai Agencies', 60000, 12, '2025-10-20', 6)

    add_b('Lakshmana Gowda', 'Krishnaiah', 'Neeralgi (V), Hiriyur (T)',
          '7760021021', 'Nagesh Raju', '8088022022', 'Hiriyur',
          'Mini Truck', 'KA-16-BK-6005', '61220', 'B1220', '2220', 'M-220', 'Book-4/M-220',
          'Indian Motors', 100000, 18, '2025-07-25', 9)

    add_b('Shivarama Rao', 'Ramaiah', 'Nerale (V), Challakere (T)',
          '9739023023', 'Ganesh Kumar', '9880024024', 'Challakere',
          'Auto', 'KA-17-GK-6006', '61221', 'B1221', '2221', 'M-221', 'Book-4/M-221',
          'Divya Motors', 75000, 12, '2025-08-03', 9)

    add_b('Veeraiah Reddy', 'Thimmaiah', 'Gollarahatti (V), Hosadurga (T)',
          '9901025025', 'Muniyappa Gowda', '7760026026', 'Hosadurga',
          'Auto', 'KA-14-HJ-6007', '61222', 'B1222', '2222', 'M-222', 'Book-4/M-222',
          'Sri Ram Motors', 50000, 12, '2025-09-12', 8)

    add_b('Channappa Patil', 'Venkataramaiah', 'Maradihalli (V), Chitradurga (T)',
          '8088027027', 'Shivaraj Naik', '9739028028', 'Chitradurga',
          'Auto', 'KA-16-AC-6008', '61223', 'B1223', '2223', 'M-223', 'Book-4/M-223',
          'Laxmi Motors', 80000, 12, '2025-10-30', 6)

    add_b('Halappa Gowda', 'Basavaiah', 'Ajjampura (V), Holalkere (T)',
          '9880029029', 'Boraiah Rao', '9901030030', 'Holalkere',
          'Mini Truck', 'KA-16-EZ-6009', '61224', 'B1224', '2224', 'M-224', 'Book-4/M-224',
          'Indian Motors', 120000, 18, '2025-11-10', 6)

    add_b('Gangadhar Swamy', 'Hanumaiah', 'Challakere (T)',
          '7760031031', 'Lokesh Hegde', '8088032032', 'Challakere',
          'Auto', 'KA-17-BC-6010', '61225', 'B1225', '2225', 'M-225', 'Book-5/M-225',
          'Sai Agencies', 60000, 12, '2025-11-22', 5)

    add_b('Srinivasa Rao', 'Muniyappa', 'Kamasamudra (V), Challakere (T)',
          '9739033033', 'Prabhakar Setty', '9880034034', 'Challakere',
          'Auto', 'KA-16-AB-6011', '61226', 'B1226', '2226', 'M-226', 'Book-5/M-226',
          'Divya Motors', 90000, 18, '2025-12-01', 5)

    add_b('Lokesh Kumar', 'Shivaramu', 'Bharamasagara (V), Challakere (T)',
          '9901035035', 'Ramesh Patil', '7760036036', 'Challakere',
          'Auto', 'KA-15-BK-6012', '61227', 'B1227', '2227', 'M-227', 'Book-5/M-227',
          'Sri Ram Motors', 75000, 12, '2025-12-15', 5)

    # ── CLOSED (8) — fully paid, loan closed ─────────────────
    add_b('Mallesh Naik', 'Lakshmaiah', 'Challakere (T)',
          '8088037037', 'Suresh Gowda', '9739038038', 'Challakere',
          'Auto', 'KA-16-GK-7001', '61228', 'B1228', '2228', 'M-228', 'Book-5/M-228',
          'Laxmi Motors', 50000, 12, '2023-01-15', 12, closed=True)

    add_b('Chandre Gowda', 'Narasimhaiah', 'Hiriyur (T)',
          '9880039039', 'Dinesh Naik', '9901040040', 'Hiriyur',
          'Auto', 'KA-17-HJ-7002', '61229', 'B1229', '2229', 'M-229', 'Book-5/M-229',
          'Indian Motors', 75000, 12, '2023-04-10', 12, closed=True)

    add_b('Shivappa Hegde', 'Rangaiah', 'Holalkere (T)',
          '7760041041', 'Kiran Reddy', '8088042042', 'Holalkere',
          'Mini Truck', 'KA-16-AC-7003', '61230', 'B1230', '2230', 'M-230', 'Book-6/M-230',
          'Sri Ram Motors', 100000, 12, '2023-07-20', 12, closed=True)

    add_b('Prasad Murthy', 'Krishnaiah', 'Hosadurga (T)',
          '9739043043', 'Naveen Swamy', '9880044044', 'Hosadurga',
          'Auto', 'KA-14-AB-7004', '61231', 'B1231', '2231', 'M-231', 'Book-6/M-231',
          'Divya Motors', 80000, 12, '2023-10-05', 12, closed=True)

    add_b('Umesh Setty', 'Ramaiah', 'Chitradurga (T)',
          '9901045045', 'Santosh Rao', '7760046046', 'Chitradurga',
          'Auto', 'KA-16-BC-7005', '61232', 'B1232', '2232', 'M-232', 'Book-6/M-232',
          'Laxmi Motors', 60000, 12, '2024-01-12', 12, closed=True)

    add_b('Anil Kumar', 'Thimmaiah', 'Challakere (T)',
          '8088047047', 'Girish Patil', '9739048048', 'Challakere',
          'Auto', 'KA-17-EZ-7006', '61233', 'B1233', '2233', 'M-233', 'Book-6/M-233',
          'Indian Motors', 90000, 12, '2024-02-28', 12, closed=True)

    add_b('Siddaraju Gowda', 'Venkataramaiah', 'Hiriyur (T)',
          '9880049049', 'Mahesh Raju', '9901050050', 'Hiriyur',
          'Auto', 'KA-16-BK-7007', '61234', 'B1234', '2234', 'M-234', 'Book-6/M-234',
          'Sai Agencies', 50000, 12, '2023-05-01', 12, closed=True)

    add_b('Muniyappa Naik', 'Basavaiah', 'Challakere (T)',
          '7760051051', 'Siddesh Hegde', '8088052052', 'Challakere',
          'Tractor', 'KA-15-GK-7008', '61235', 'B1235', '2235', 'M-235', 'Book-7/M-235',
          'Sri Ram Motors', 150000, 24, '2023-06-15', 24, closed=True)

    # ── ADVANCE (5) — paid MORE than expected ─────────────────
    # add_pays then extra advance payment = 3 * installment
    add_b('Boraiah Gowda', 'Hanumaiah', 'Kamasamudra (V), Challakere (T)',
          '9739053053', 'Thimmaiah Swamy', '9880054054', 'Challakere',
          'Auto', 'KA-16-AC-8001', '61236', 'B1236', '2236', 'M-236', 'Book-7/M-236',
          'Divya Motors', 75000, 12, '2025-08-08', 9,
          advance=emi(75000, 12) * 3)

    add_b('Thippeswamy Naik', 'Muniyappa', 'Joladal (V), Challakere (T)',
          '9901055055', 'Rajappa Naik', '7760056056', 'Challakere',
          'Auto', 'KA-17-AB-8002', '61237', 'B1237', '2237', 'M-237', 'Book-7/M-237',
          'Laxmi Motors', 60000, 12, '2025-09-22', 7,
          advance=emi(60000, 12) * 3)

    add_b('Savitha Gowda', 'Rajesh Gowda', 'Neeralgi (V), Hiriyur (T)',
          '8088057057', 'Lakshmana Patil', '9739058058', 'Hiriyur',
          'Auto', 'KA-16-BC-8003', '61238', 'B1238', '2238', 'M-238', 'Book-7/M-238',
          'Indian Motors', 80000, 12, '2025-10-14', 7,
          advance=emi(80000, 12) * 3)

    add_b('Kamala Reddy', 'Venkataramaiah', 'Gollarahatti (V), Hosadurga (T)',
          '9880059059', 'Shivaraj Kumar', '9901060060', 'Hosadurga',
          'Auto', 'KA-14-HJ-8004', '61239', 'B1239', '2239', 'M-239', 'Book-7/M-239',
          'Sri Ram Motors', 50000, 12, '2025-11-05', 6,
          advance=emi(50000, 12) * 3)

    add_b('Saroja Naik', 'Basavaiah', 'Maradihalli (V), Chitradurga (T)',
          '7760061061', 'Ganesh Raju', '8088062062', 'Chitradurga',
          'Auto', 'KA-17-GK-8005', '61240', 'B1240', '2240', 'M-240', 'Book-8/M-240',
          'Sai Agencies', 75000, 12, '2025-12-18', 5,
          advance=emi(75000, 12) * 3)

    # ── DUE SOON (5) — next payment due in 1–5 days ──────────
    # Loan date on 20-24 May 2025, period=18, paid exactly 11 installments.
    # expected=11, next_due = same day 2026 → 1-5 days away.
    add_b('Lakshmi Patil', 'Hanumaiah', 'Ramajogihalli (V), Holalkere (T)',
          '9739063063', 'Srinivasa Naik', '9880064064', 'Holalkere',
          'Auto', 'KA-16-EZ-9001', '61241', 'B1241', '2241', 'M-241', 'Book-8/M-241',
          'Indian Motors', 60000, 18, '2025-05-20', 11)  # due in 1 day

    add_b('Jayamma Gowda', 'Shivaramu', 'Nerale (V), Challakere (T)',
          '9901065065', 'Boraiah Hegde', '7760066066', 'Challakere',
          'Auto', 'KA-17-AC-9002', '61242', 'B1242', '2242', 'M-242', 'Book-8/M-242',
          'Divya Motors', 75000, 18, '2025-05-21', 11)  # due in 2 days

    add_b('Sumathi Rao', 'Lakshmaiah', 'Kamasamudra (V), Challakere (T)',
          '8088067067', 'Kiran Setty', '9739068068', 'Challakere',
          'Auto', 'KA-16-AB-9003', '61243', 'B1243', '2243', 'M-243', 'Book-8/M-243',
          'Sri Ram Motors', 80000, 18, '2025-05-22', 11)  # due in 3 days

    add_b('Pushpa Hegde', 'Narasimhaiah', 'Ajjampura (V), Holalkere (T)',
          '9880069069', 'Mallesh Kumar', '9901070070', 'Holalkere',
          'Mini Truck', 'KA-15-BC-9004', '61244', 'B1244', '2244', 'M-244', 'Book-9/M-244',
          'Laxmi Motors', 100000, 18, '2025-05-23', 11)  # due in 4 days

    add_b('Roopa Kumar', 'Rangaiah', 'Parashurampura (V), Challakere (T)',
          '7760071071', 'Veeraiah Gowda', '8088072072', 'Challakere',
          'Auto', 'KA-16-BK-9005', '61245', 'B1245', '2245', 'M-245', 'Book-9/M-245',
          'Indian Motors', 50000, 18, '2025-05-24', 11)  # due in 5 days

    # ── NEW LOANS (5) — recent, on time ──────────────────────
    add_b('Manjula Swamy', 'Krishnaiah', 'Hiriyur (T)',
          '9739073073', 'Siddesh Patil', '9880074074', 'Hiriyur',
          'Auto', 'KA-17-EZ-0101', '61246', 'B1246', '2246', 'M-246', 'Book-9/M-246',
          'Sai Agencies', 75000, 12, '2026-01-15', 4)

    add_b('Shantha Naik', 'Ramaiah', 'Challakere (T)',
          '9901075075', 'Naveen Gowda', '7760076076', 'Challakere',
          'Auto', 'KA-16-GK-0102', '61247', 'B1247', '2247', 'M-247', 'Book-9/M-247',
          'Divya Motors', 60000, 12, '2026-02-10', 3)

    add_b('Murugan Pillai', 'Krishnaiah', 'Chitradurga (T)',
          '8088077077', 'Prasad Naik', '9739078078', 'Chitradurga',
          'Auto', 'KA-14-HJ-0103', '61248', 'B1248', '2248', 'M-248', 'Book-9/M-248',
          'Sri Ram Motors', 100000, 18, '2026-03-05', 2)

    add_b('Venkataramaiah Reddy', 'Thimmaiah', 'Hosadurga (T)',
          '9880079079', 'Ramu Setty', '9901080080', 'Hosadurga',
          'Auto', 'KA-16-AC-0104', '61249', 'B1249', '2249', 'M-249', 'Book-9/M-249',
          'Laxmi Motors', 80000, 12, '2026-01-22', 3)

    add_b('Ravi Shankar', 'Venkataramaiah', 'Bharamasagara (V), Challakere (T)',
          '7760081081', 'Halappa Reddy', '8088082082', 'Challakere',
          'Auto', 'KA-17-AB-0105', '61250', 'B1250', '2250', 'M-250', 'Book-9/M-250',
          'Indian Motors', 50000, 12, '2026-02-28', 2)

    total = len(db.list_borrowers())
    print(f"\nSeeded successfully!")
    print(f"   Total borrowers in DB: {total}")

    # Print summary
    from api import API
    api = API()
    p = api.get_portfolio_summary()
    ds = api.get_due_soon()
    print(f"\nPortfolio:")
    print(f"   Total loans      : {p['total_loans']}")
    print(f"   Active           : {p['active_loans']}  |  Closed: {p['closed_loans']}")
    print(f"   Overdue          : {p['overdue_count']} borrowers")
    print(f"   Total principal  : Rs.{p['total_principal']:,.0f}")
    print(f"   Total collected  : Rs.{p['total_collected']:,.0f}")
    print(f"   Outstanding      : Rs.{p['total_outstanding']:,.0f}")
    print(f"\nDue in 7 days   : {len(ds)} borrowers")
    for d in ds:
        print(f"   {d['name']} - {d['next_due_date']} ({d['days_until']}d) - Rs.{d['installment_amount']:,.0f}")


if __name__ == '__main__':
    seed()
