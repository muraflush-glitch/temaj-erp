# Raport sesioni — 2026-11-19 — Faza 2 (prototip): libri kryesor

**Dega Git:** faza-2-libri-kryesor · **Mjedisi:** Development lokal (PostgreSQL 16.15, Node 22.23.5) · **Production:** nuk ekziston

## Çfarë u ndërtua
- Migrimi `003_ledger.sql`: llogaritë, periudhat fiskale, regjistrimet me partia të dyfishta, numëruesi pa boshllëqe
- Rregulla të zbatuara nga databaza: debi = kredi; së paku 2 rreshta; regjistrimi i postuar dhe rreshtat e tij janë të pandryshueshëm; nuk postohet në periudhë të mbyllur ose pa periudhë; periudha e mbyllur nuk rihapet; periudhat nuk mbivendosen
- Kthimi (storno) si e vetmja rrugë korrigjimi, një herë për regjistrim
- Mbyllja e periudhës vetëm përmes aprovimit me katër sy dhe 2FA
- Lejet sipas degës për krijim, postim, kthim dhe lexim
- Bilanci vërtetues, për kompaninë ose për një degë
- Faqja "Libri kryesor" në ndërfaqe (vetëm lexim)
- CI: veprimet e GitHub u përditësuan në v5

## Çfarë NUK është vendosur (pret kontabilistin)
- Llogaritë janë TESTUESE (T-1000 … T-6000), jo plani kontabël i Temaj-it (OPEN-05)
- Asnjë rregull TVSH-je, vlerësimi stoku apo pagash
- Saktësia e parasë: ruhet NUMERIC(19,4) pa rrumbullakim; politika pret miratim
- A duhet që postuesi të jetë person tjetër nga krijuesi i regjistrimit: tani nuk kërkohet — vendim i hapur
- Rihapja e periudhës: tani e pamundur; procesi i kontrolluar pret politikën kontabël
- Mbyllja kërkon që të mos ketë drafte në periudhë — rregull provizor

## Shënim për testet
Shembulli i avansit 200 € me katër bonuse 50 € tregon vetëm se libri e shpreh kompensimin pa prekur arkën. Trajtimi kontabël i saktë (llogaritë, momenti) mbetet vendim i kontabilistit.

## Komandat e ekzekutuara realisht
```
npm run typecheck                 → OK
npx jest --runInBand              → 69/69 kaluan (41 të mëparshme + 28 të reja), 3 herë rresht
npm run build                     → OK
npm audit --omit=dev              → 0 dobësi
npm run db:migrate (mbi DB ekzistuese me 001) → aplikoi 002 dhe 003; ekzekutimi i dytë nuk bëri asgjë
```
Ndërfaqja web nuk është testuar me shfletues automatik.

## Log-u i testeve
```
PASS test/foundation.e2e.spec.ts (5.507 s)
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
Tests:       69 passed, 69 total
```
