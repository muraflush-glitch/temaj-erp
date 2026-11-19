# Raport sesioni — 2026-11-19 — Arka ditore, formularët e blerjeve, printimi i faturës, përgatitja e serverit

**Dega Git:** arka-blerjet-printimi · **Mjedisi:** Development lokal · **Production:** nuk ekziston

## Çfarë u ndërtua
- Migrimi `008_cash_sessions.sql`: arkat sipas degës dhe seancat ditore
- Arka: hapje, arkëtime me para në dorë vetëm me arkë të hapur, mbyllje me numërim; shumën e pritur e llogarit sistemi
- Mungesa ose teprica kërkon arsyetim dhe aprovim nga një person tjetër me 2FA; gjatë pritjes arka është e bllokuar; refuzimi kërkon rinumërim
- Në mbyllje regjistrohen në libër mungesa (shpenzim), teprica (e ardhur e veçantë) dhe paratë e nxjerra për bankë ("para në rrugë")
- Dita tjetër fillon me paratë e mbetura në arkë
- Faqja e printueshme e faturës, me vulën "dokument provizor — jo faturë fiskale"
- Formularët e blerjeve: furnitor i ri, porosi blerjeje, dërgim, pranim malli, faturë e furnitorit
- Web-i i përcjell kërkesat te API-ja (`/api`), kështu që mjafton një adresë publike
- Skedarët për ngritjen në server: `Dockerfile`, `deploy/docker-compose.yml`, `deploy/Caddyfile` (HTTPS), `deploy/README.md`

## Vlera provizore të shtuara
| Çfarë | Vlera | Ku ndryshohet |
| --- | --- | --- |
| Toleranca e arkës | 0 € — çdo diferencë kërkon aprovim | `approval_policy` → `cash.close_difference` |
| Llogaritë e arkës | T-1050 para në rrugë, T-4100 teprica, T-6100 mungesa | `account_role` |
| Dorëzimi në bankë | Regjistrohet si "para në rrugë" në mbyllje; konfirmimi nga banka nuk është ndërtuar | `cash.service.ts` |

## Çfarë NUK është bërë
- Skedarët e Docker-it nuk janë provuar në një server të vërtetë (pa Docker aktiv në këtë mjedis)
- Serveri vetë: nuk ekziston; duhet një makinë me Docker dhe një emër domeni
- Konfirmimi i depozitës nga banka, pagesat nga arka (shpenzime), disa arka për degë
- Formularët për transferet, korrigjimet e stokut, çmimet dhe menaxhimin e përdoruesve

## Komandat e ekzekutuara realisht
```
npm run typecheck          → OK
npx jest --runInBand       → 160/160 kaluan (150 të mëparshme + 10 të reja)
npm run build              → OK
npm audit --omit=dev       → 0 dobësi
scripts/e2e-local.sh       → 19 hapa në Chrome kaluan (përfshirë arkën, printimin dhe blerjet)
node apps/api/dist/database/migrate.cli.js → OK (komanda që përdor serveri)
```

## Log-u i testeve
```
PASS test/cash.e2e.spec.ts
    ✓ me arkë të mbyllur nuk arkëtohet para në dorë, por banka pranohet
    ✓ arkëtari i degës tjetër nuk e hap arkën e Prizrenit; arka nuk hapet dy herë
    ✓ shuma e pritur llogaritet nga sistemi: vetëm arkëtimet me para në dorë
    ✓ numërimi me mungesë kërkon arsyetim; arka bllokohet derisa të vendosë aprovuesi
    ✓ mungesa e aprovuar regjistrohet si shpenzim dhe arka në libër përputhet me paratë e numëruara
    ✓ seanca e mbyllur nuk ndryshohet, as në databazë
    ✓ dita tjetër fillon me paratë e mbetura; mbyllja pa diferencë nuk kërkon aprovim
    ✓ teprica regjistrohet si e ardhur e veçantë, jo si shitje
    ✓ sistemi e vendos vetë shumën e pritur edhe nëse dikush e shkruan me dorë
    ✓ arkëtimi me para në dorë nuk lidhet dot me një seancë të mbyllur
PASS test/foundation.e2e.spec.ts
    ✓ ekzekutimi i dytë nuk aplikon asgjë
    ✓ zbulon një migrim të ndryshuar pas aplikimit
    ✓ pa token → 401; /health është publik
    ✓ fjalëkalim i gabuar → 401 me mesazh të përgjithshëm
    ✓ bllokon llogarinë pas 5 tentativave të dështuara
    ✓ /auth/me kthen lejet; logout e revokon sesionin menjëherë
    ✓ token-i nuk ruhet në databazë, vetëm hash-i i tij
    ✓ me 2FA aktive, hyrja pa kod refuzohet
    ✓ përdorues pa rol nuk lexon degët as auditin
    ✓ roli i skaduar nuk jep më leje
    ✓ të dyja degët ekzistojnë me magazinat e tyre
    ✓ dhënia e rolit krijon kërkesë në pritje, jo rol të menjëhershëm
    ✓ e njëjta kërkesë e dërguar dy herë nuk krijon dy aprovime (idempotencë)
    ✓ aprovuesi pa 2FA në sesion bllokohet (step-up)
    ✓ aprovuesi me 2FA aprovon → roli jepet në të njëjtin transaksion
    ✓ vendimi i dytë mbi të njëjtën kërkesë refuzohet
    ✓ databaza vetë e ndalon vetë-aprovimin, edhe nëse kodi anashkalohet
    ✓ nuk mund të kërkosh role për veten
    ✓ refuzimi nuk jep rolin
    ✓ veprim pa politikë aprovimi bllokohet (fail closed)
    ✓ heqja e rolit hyn në fuqi menjëherë
    ✓ çaktivizimi i përdoruesit revokon sesionet e hapura
    ✓ regjistron veprimet kryesore
    ✓ nuk ruan fjalëkalime ose hash-e në audit
    ✓ UPDATE dhe DELETE mbi auditin refuzohen
    ✓ zinxhiri mbetet i rregullt edhe me 200 shkrime paralele
    ✓ zinxhiri i hash-eve është i paprekur dhe zbulon ndërhyrjen
PASS test/sales.e2e.spec.ts
    ✓ oferta merr çmimin e listës dhe nuk rezervon stok
    ✓ konfirmimi brenda limiteve e rezervon stokun pa aprovim
    ✓ porosia e konfirmuar nuk ndryshohet, as drejtpërdrejt në databazë
    ✓ malli i rezervuar nuk del për dikë tjetër
    ✓ nuk rezervohet më shumë se stoku i lirë
    ✓ 10 porosi paralele për 3 WC të lira: saktësisht 3 konfirmohen
    ✓ oferta pa kuti të plota, pa lot ose pa çmim refuzohet
    ✓ shitësi nuk dorëzon; dorëzon magazinieri
    ✓ dorëzimi i pjesshëm ul stokun fizik dhe rezervimin bashkë
    ✓ i njëjti dorëzim i dërguar dy herë nuk e ul stokun dy herë
    ✓ nuk dorëzohet më shumë se sa është porositur
    ✓ dorëzimi i fundit e mbyll porosinë; pas kësaj asgjë nuk ndryshon
    ✓ porosia e anuluar e liron mallin; porosia me dorëzime nuk anulohet
    ✓ rezervimet në gjendje përputhen gjithmonë me rreshtat e rezervimit
    ✓ zbritja mbi limitin e shitësit kërkon arsyetim dhe aprovim; stoku rezervohet vetëm pas aprovimit
    ✓ çmimi i ndryshuar me dorë kërkon aprovim; refuzimi e kthen porosinë në ofertë
    ✓ përzierja e nuancave të të njëjtit produkt bllokohet pa aprovim
    ✓ shitësi i Prishtinës nuk krijon dhe nuk sheh porosi të Prizrenit
    ✓ shitësi nuk vendos çmime liste as limit krediti
    ✓ çmimi i vendosur nuk mbishkruhet; ndryshimi kërkon datë të re
    ✓ audit trail i ka veprimet e shitjes dhe zinxhiri është i paprekur
PASS test/ledger.e2e.spec.ts
    ✓ regjistrimi i balancuar postohet dhe merr numër
    ✓ regjistrimi i pabalancuar refuzohet
    ✓ databaza vetë e refuzon postimin e pabalancuar, edhe pa API
    ✓ rreshti me debi dhe kredi njëkohësisht, ose me zero, refuzohet
    ✓ shumat ruhen saktësisht si dhjetore: 0.10 + 0.20 = 0.30
    ✓ data pa periudhë fiskale refuzohet
    ✓ idempotenca: e njëjta kërkesë nuk krijon dy regjistrime
    ✓ postimi i dytë i të njëjtit regjistrim refuzohet
    ✓ regjistrimi i postuar nuk ndryshohet, nuk fshihet dhe nuk kthehet në draft
    ✓ rreshtat e tij nuk ndryshohen, nuk fshihen dhe nuk shtohen
    ✓ kthimi (storno) krijon regjistrim të kundërt dhe e zeron efektin; origjinali mbetet
    ✓ një regjistrim kthehet vetëm një herë
    ✓ debia totale = kredia totale, gjithmonë
    ✓ draftet nuk hyjnë në bilanc
    ✓ shembulli kritik: avans 200 € dhe katër bonuse 50 € si kompensim — arka NUK rritet
    ✓ bilanci sipas degës i ndan Prizrenin dhe Prishtinën
    ✓ numrat e regjistrimeve janë pa boshllëqe, edhe me 20 postime paralele
    ✓ dështimi i postimit nuk harxhon numër
    ✓ kontabilisti i Prizrenit nuk regjistron për Prishtinën as në nivel kompanie
    ✓ kontabilisti i Prizrenit nuk sheh bilancin e kompanisë as të Prishtinës
    ✓ aprovuesi financiar lexon, por nuk krijon regjistrime
    ✓ periudha me drafte të papostuara nuk mbyllet
    ✓ kontabilisti nuk e mbyll dot vetë periudhën; duhet aprovues tjetër me 2FA
    ✓ në periudhën e mbyllur nuk postohet më
    ✓ periudha e mbyllur nuk rihapet, as drejtpërdrejt në databazë
    ✓ korrigjimi i një regjistrimi të periudhës së mbyllur bëhet me kthim në periudhën e hapur
    ✓ periudhat nuk mbivendosen
    ✓ audit trail i ka regjistruar veprimet e librit dhe zinxhiri është i paprekur
PASS test/billing.e2e.spec.ts
    ✓ pa arkëtim nuk lëshohet
    ✓ lëshohet me arkëtim: TVSH-ja llogaritet, libri regjistrohet dhe arka rritet saktësisht sa pagesa
    ✓ e njëjta kërkesë e dërguar dy herë nuk krijon dy fatura as dy arkëtime
    ✓ i njëjti mall nuk faturohet dy herë
    ✓ faturohet vetëm malli i dorëzuar
    ✓ shitësi dhe magazinieri nuk lëshojnë fatura
    ✓ faturat janë të pandryshueshme, me numra pa boshllëqe, dhe asnjëra nuk shënohet si fiskale
    ✓ fatura me kredi nuk kërkon arkëtim; klienti mbetet borxh me afat pagese
    ✓ arkëtimi i pjesshëm e ul borxhin; arka rritet vetëm sa paratë e marra
    ✓ pagesa më e madhe se borxhi: teprica mbetet avans i klientit, jo e ardhur
    ✓ databaza nuk lejon që një faturë të paguhet më shumë se vlera e saj
    ✓ porosia me kredi mbi limitin e klientit kërkon aprovim
    ✓ klienti me kredi brenda limitit konfirmohet pa aprovim
    ✓ libri kryesor mbetet i balancuar dhe çdo faturë e arkëtim ka regjistrimin e vet të postuar
    ✓ në periudhë të mbyllur nuk lëshohet faturë
    ✓ Production refuzon të niset me rregulla provizore
    ✓ audit trail i paprekur
PASS test/inventory.e2e.spec.ts
    ✓ hyrja e pllakave me lot rrit stokun dhe shfaq kutitë
    ✓ pllaka pa lot (nuancë/kalibër) refuzohet
    ✓ sasia që nuk është kuti e plotë refuzohet për produktin pa kuti të hapura
    ✓ produkti me kuti të hapura lejon copë, por jo pjesë cope
    ✓ produkti me copë nuk pranon lot dhe as sasi me presje
    ✓ idempotenca: e njëjta hyrje e dërguar dy herë numërohet një herë
    ✓ nuancat e ndryshme mbahen të ndara
    ✓ dalja më e madhe se stoku refuzohet dhe stoku nuk ndryshon
    ✓ stoku i një nuance nuk mbulon daljen e një nuance tjetër
    ✓ 20 dalje paralele mbi 7 copë: saktësisht 7 kalojnë, stoku përfundon zero
    ✓ gjendja nuk ndryshohet drejtpërdrejt në databazë, vetëm përmes lëvizjeve
    ✓ lëvizjet nuk ndryshohen dhe nuk fshihen
    ✓ lëvizja pa dokument refuzohet
    ✓ gjendja është gjithmonë e barabartë me shumën e lëvizjeve
    ✓ paketimi i produktit me lëvizje nuk ndryshohet
    ✓ magazinieri i Prishtinës nuk prek dhe nuk sheh magazinën e Prizrenit
    ✓ vetëm menaxheri i katalogut krijon produkte; m² kërkon paketimin
    ✓ dërgimi e ul stokun në Prizren; Prishtina nuk e sheh mallin derisa ta pranojë
    ✓ dërguesi nuk e konfirmon dot vetë pranimin, as dikush nga dega dërguese
    ✓ nuk pranohet më shumë se sa është dërguar
    ✓ pranimi i plotë nga dega pranuese e fut mallin në Prishtinë me të njëjtin lot
    ✓ pranimi i dytë refuzohet
    ✓ transferi me më shumë se stoku refuzohet i tëri
    ✓ pranimi me mungesë shënohet si diferencë për hetim; mungesa nuk hyn askund
    ✓ magazinieri vetëm kërkon; stoku ndryshon pasi aprovon menaxheri me 2FA
    ✓ korrigjimi që do ta bënte stokun negativ dështon edhe pas aprovimit
    ✓ audit trail i ka veprimet e stokut dhe zinxhiri është i paprekur
PASS test/purchasing.e2e.spec.ts
    ✓ nën prag aprovohet menjëherë
    ✓ mbi prag kërkon arsyetim dhe aprovues tjetër me 2FA; malli nuk pranohet para aprovimit
    ✓ refuzimi e kthen porosinë në draft
    ✓ porosia e dërguar nuk ndryshohet, as drejtpërdrejt në databazë
    ✓ valuta e huaj nuk pranohet ende
    ✓ pranimi i pjesshëm hyn në stok me lot dhe e shënon porosinë si të pranuar pjesërisht
    ✓ i njëjti pranim i dërguar dy herë nuk hyn dy herë në stok
    ✓ nuk pranohet më shumë se sa është porositur, pa lot, ose nga dega tjetër
    ✓ pranimi i fundit e mbyll porosinë
    ✓ pranimet janë të pandryshueshme dhe lidhen me lëvizjet e stokut
    ✓ fatura për më shumë se malli i pranuar bllokohet si mospërputhje
    ✓ fatura me çmim ndryshe nga porosia bllokohet si mospërputhje
    ✓ fatura që përputhet me porosinë dhe pranimin pranohet
    ✓ i njëjti mall nuk faturohet dy herë
    ✓ blerësi dhe magazinieri nuk regjistrojnë fatura; financa nuk pranon mall
    ✓ faturat e regjistruara nuk ndryshohen; audit trail është i plotë dhe i paprekur
PASS test/hardening.e2e.spec.ts
    ✓ çelësi 2FA nuk ruhet si tekst i lexueshëm në databazë
    ✓ databaza refuzon një çelës 2FA të paenkriptuar
    ✓ sekreti i kopjuar te një përdorues tjetër nuk dekriptohet (AAD)
    ✓ rrotullimi i çelësit: të dhënat e vjetra lexohen ende me çelësin e vjetër
    ✓ ndryshimi i një bajti zbulohet (GCM)
    ✓ pas kufirit, edhe fjalëkalimi i saktë refuzohet me 429 nga e njëjta IP
    ✓ idempotenca: e njëjta ngjarje nuk regjistrohet dy herë
    ✓ ngjarja e anuluar me rollback nuk dërgohet kurrë
    ✓ dështimi riprovohet me vonesë dhe pas kufirit shkon në dead-letter
    ✓ dy punëtorë paralelë nuk e përpunojnë të njëjtën ngjarje dy herë
    ✓ kërkesa e vonuar njofton aprovuesit një herë, jo kërkuesin
PASS test/crypto.spec.ts
    ✓ TOTP përputhet me vektorin zyrtar të RFC 6238 (SHA-1, T=59s)
    ✓ TOTP pranon ±30 s por refuzon kode të vjetra
    ✓ fjalëkalimet: hash i kripur, verifikim i saktë, refuzim i fjalëkalimeve të shkurtra
Tests:       160 passed, 160 total
```
