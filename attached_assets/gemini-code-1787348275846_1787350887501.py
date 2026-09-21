import os
import weasyprint

html_content = """<!DOCTYPE html>
<html lang="sl">
<head>
    <meta charset="UTF-8">
    <title>Kontni okvir za gospodarske družbe (SRS)</title>
    <style>
        @page {
            size: A4;
            margin: 12mm 10mm;
            background-color: #ffffff;
            @bottom-right {
                content: "Stran " counter(page) " od " counter(pages);
                font-family: 'Helvetica Neue', Arial, sans-serif;
                font-size: 8pt;
                color: #666666;
            }
            @bottom-left {
                content: "Enotni kontni okvir po SRS";
                font-family: 'Helvetica Neue', Arial, sans-serif;
                font-size: 8pt;
                color: #666666;
            }
        }

        *, *::before, *::after {
            box-sizing: border-box;
        }

        body {
            font-family: 'Helvetica Neue', Arial, sans-serif;
            margin: 0;
            padding: 0;
            color: #222222;
            font-size: 9.5pt;
            line-height: 1.35;
        }

        .header {
            background-color: #1a365d;
            color: #ffffff;
            padding: 16px 20px;
            margin-bottom: 15px;
            border-radius: 4px;
        }

        .header h1 {
            margin: 0 0 4px 0;
            font-size: 18pt;
            font-weight: 700;
            letter-spacing: 0.5px;
        }

        .header p {
            margin: 0;
            font-size: 10pt;
            opacity: 0.85;
        }

        .class-section {
            margin-bottom: 14px;
            page-break-inside: auto;
        }

        .class-title {
            background-color: #2b6cb0;
            color: #ffffff;
            padding: 6px 10px;
            font-size: 11pt;
            font-weight: bold;
            border-radius: 3px;
            margin-bottom: 8px;
            page-break-after: avoid;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 8px;
            font-size: 9pt;
        }

        th {
            background-color: #edf2f7;
            color: #2d3748;
            text-align: left;
            padding: 5px 8px;
            font-weight: bold;
            border-bottom: 2px solid #cbd5e0;
        }

        td {
            padding: 4px 8px;
            border-bottom: 1px solid #e2e8f0;
            vertical-align: top;
        }

        tr:nth-child(even) td {
            background-color: #f7fafc;
        }

        tr {
            page-break-inside: avoid;
        }

        .konto-code {
            font-family: 'Courier New', Courier, monospace;
            font-weight: bold;
            color: #1a365d;
            width: 70px;
        }

        .konto-name {
            font-weight: bold;
            color: #2d3748;
            width: 240px;
        }

        .analitika-list {
            margin: 0;
            padding-left: 0;
            list-style: none;
        }

        .analitika-list li {
            margin-bottom: 2px;
        }

        .analitika-code {
            font-family: 'Courier New', Courier, monospace;
            color: #2b6cb0;
            font-weight: bold;
        }
    </style>
</head>
<body>

    <div class="header">
        <h1>KONTNI OKVIR ZA GOSPODARSKE DRUŽBE</h1>
        <p>Sintetična in analitična členitev po Slovenskih računovodskih standardih (SRS)</p>
    </div>

    <!-- RAZRED 0 -->
    <div class="class-section">
        <div class="class-title">RAZRED 0: Neopredmetena sredstva in opredmetena osnovna sredstva</div>
        <table>
            <thead>
                <tr>
                    <th style="width: 70px;">Konto</th>
                    <th style="width: 240px;">Sintetika</th>
                    <th>Analitični konti</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="konto-code">000</td>
                    <td class="konto-name">Stroški razvoja</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">0000</span> – Aktiviran lastni razvoj proizvodov ali storitev</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">001</td>
                    <td class="konto-name">Premoženjske pravice</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">0010</span> – Programska oprema (računalniške licence)</li>
                            <li><span class="analitika-code">0011</span> – Blagovne znamke in patenti</li>
                            <li><span class="analitika-code">0012</span> – Koncesije in posebne pravice</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">008</td>
                    <td class="konto-name">Popravek vrednosti neopredmetenih sredstev</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">0081</span> – Amortizacija programske opreme</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">020</td>
                    <td class="konto-name">Zemljišča</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">0200</span> – Poslovna zemljišča (stavbna)</li>
                            <li><span class="analitika-code">0201</span> – Kmetijska in gozdna zemljišča</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">021</td>
                    <td class="konto-name">Zgradbe</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">0210</span> – Upravne zgradbe in pisarne</li>
                            <li><span class="analitika-code">0211</span> – Proizvodni objekti in delavnice</li>
                            <li><span class="analitika-code">0212</span> – Skladiščni objekti</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">028</td>
                    <td class="konto-name">Popravek vrednosti zgradb</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">0281</span> – Amortizacija zgradb</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">040</td>
                    <td class="konto-name">Proizvodna oprema in stroji</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">0400</span> – Stroji in proizvodne linije</li>
                            <li><span class="analitika-code">0401</span> – Orodja in merilne naprave</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">041</td>
                    <td class="konto-name">Druga oprema in transportna sredstva</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">0410</span> – Računalniška in IT oprema</li>
                            <li><span class="analitika-code">0411</span> – Pisarniški pohištvo in inventar</li>
                            <li><span class="analitika-code">0412</span> – Osebna vozila</li>
                            <li><span class="analitika-code">0413</span> – Tovorna in dostavna vozila</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">048</td>
                    <td class="konto-name">Popravek vrednosti druge opreme</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">0480</span> – Amortizacija IT opreme</li>
                            <li><span class="analitika-code">0482</span> – Amortizacija osebnih vozil</li>
                            <li><span class="analitika-code">0483</span> – Amortizacija tovornih vozil</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">050</td>
                    <td class="konto-name">Naložbene nepremičnine</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">0500</span> – Zemljišča in zgradbe, dane v najem ali za povečanje vrednosti</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">060-063</td>
                    <td class="konto-name">Dolgoročne finančne naložbe</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">0600</span> – Deleži v družbah v skupini</li>
                            <li><span class="analitika-code">0610</span> – Deleži v pridruženih družbah</li>
                            <li><span class="analitika-code">0620</span> – Druge dolgoročne finančne naložbe (delnice, obveznice)</li>
                            <li><span class="analitika-code">0630</span> – Dana dolgoročna posojila</li>
                        </ul>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    <!-- RAZRED 1 -->
    <div class="class-section">
        <div class="class-title">RAZRED 1: Kratkoročna sredstva (razen zalog) in aktivne časovne razmejitve</div>
        <table>
            <thead>
                <tr>
                    <th style="width: 70px;">Konto</th>
                    <th style="width: 240px;">Sintetika</th>
                    <th>Analitični konti</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="konto-code">100</td>
                    <td class="konto-name">Blagajna</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">1000</span> – Gotovinska blagajna (EUR)</li>
                            <li><span class="analitika-code">1001</span> – Valutna blagajna (tuje valute)</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">101</td>
                    <td class="konto-name">Transakcijski računi (TRR)</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">1010</span> – Glavni TRR pri domači banki</li>
                            <li><span class="analitika-code">1011</span> – Sekundarni TRR pri drugi banki</li>
                            <li><span class="analitika-code">1012</span> – Devizni TRR</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">120</td>
                    <td class="konto-name">Terjatve do kupcev v državi</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">1200</span> – Terjatve do kupcev – neplačani računi</li>
                            <li><span class="analitika-code">1201</span> – Terjatve do kupcev – menice in drugi papirji</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">121</td>
                    <td class="konto-name">Terjatve do kupcev v tujini</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">1210</span> – Kupci iz države članic EU</li>
                            <li><span class="analitika-code">1211</span> – Kupci iz tretjih držav (izvoz)</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">124</td>
                    <td class="konto-name">Dani predujmi in varščine</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">1240</span> – Dani predujmi za storitve</li>
                            <li><span class="analitika-code">1241</span> – Dani predujmi za material ali blago</li>
                            <li><span class="analitika-code">1242</span> – Dane varščine in jamstva</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">129</td>
                    <td class="konto-name">Popravek vrednosti terjatev</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">1290</span> – Popravek vrednosti dvomljivih terjatev</li>
                            <li><span class="analitika-code">1291</span> – Popravek vrednosti spornih terjatev (v izterjavi)</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">130</td>
                    <td class="konto-name">Terjatve do zaposlenih</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">1300</span> – Akontacije za službena potovanja</li>
                            <li><span class="analitika-code">1301</span> – Odškodninske terjatve ali preplačila do zaposlenih</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">160</td>
                    <td class="konto-name">Terjatve za vstopni DDV</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">1600</span> – Vstopni DDV 22 % od nabav v državi</li>
                            <li><span class="analitika-code">1601</span> – Vstopni DDV 9,5 % od nabav v državi</li>
                            <li><span class="analitika-code">1602</span> – Vstopni DDV 5 % od nabav v državi</li>
                            <li><span class="analitika-code">1603</span> – Vstopni DDV od uvoza blaga</li>
                            <li><span class="analitika-code">1604</span> – Vstopni DDV od samoobdavčitve (pridobitve EU / 76.a člen)</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">190</td>
                    <td class="konto-name">Kratkoročno razmejeni stroški (AČR)</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">1900</span> – Vnaprej plačane najemnine</li>
                            <li><span class="analitika-code">1901</span> – Vnaprej plačane zavarovalne premije</li>
                            <li><span class="analitika-code">1902</span> – Vnaprej plačane naročnine in letni stroški</li>
                        </ul>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    <!-- RAZRED 2 -->
    <div class="class-section">
        <div class="class-title">RAZRED 2: Kratkoročne obveznosti, pasivne časovne razmejitve in rezervacije</div>
        <table>
            <thead>
                <tr>
                    <th style="width: 70px;">Konto</th>
                    <th style="width: 240px;">Sintetika</th>
                    <th>Analitični konti</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="konto-code">210</td>
                    <td class="konto-name">Obveznosti do dobaviteljev v državi</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">2100</span> – Obveznosti do domačih dobaviteljev – redni računi</li>
                            <li><span class="analitika-code">2109</span> – Nefakturirane dobave (prejeto blago/storitve brez računa)</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">211</td>
                    <td class="konto-name">Obveznosti do dobaviteljev v tujini</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">2110</span> – Dobavitelji iz EU</li>
                            <li><span class="analitika-code">2111</span> – Dobavitelji iz tretjih držav (uvoz)</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">214</td>
                    <td class="konto-name">Prejeti predujmi</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">2140</span> – Prejeti avansi od kupcev v državi</li>
                            <li><span class="analitika-code">2141</span> – Prejeti avansi od kupcev iz tujine</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">220</td>
                    <td class="konto-name">Obveznosti do zaposlenih</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">2200</span> – Obveznosti za neto plače</li>
                            <li><span class="analitika-code">2201</span> – Obveznosti za nadomestila plač (bolniške v breme podjetja/ZZZS)</li>
                            <li><span class="analitika-code">2202</span> – Obveznosti za prevoz na delo in prehrano</li>
                            <li><span class="analitika-code">2203</span> – Obveznosti za dnevnice in potne stroške</li>
                            <li><span class="analitika-code">2204</span> – Obveznosti za regres za letni dopust</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">230</td>
                    <td class="konto-name">Obveznosti za dajatve in prispevke</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">2300</span> – Obveznosti za dohodnino od plač</li>
                            <li><span class="analitika-code">2301</span> – Obveznosti za prispevke za socialno varnost (iz/na plače)</li>
                            <li><span class="analitika-code">2302</span> – Obveznosti za dajatve od avtorskih in podjemnih pogodb</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">240</td>
                    <td class="konto-name">Kratkoročni krediti pri bankah</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">2400</span> – Kratkoročni likvidnostni krediti</li>
                            <li><span class="analitika-code">2401</span> – Kratkoročni del dolgoročnih kreditov</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">260</td>
                    <td class="konto-name">Obveznosti za izstopni DDV</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">2600</span> – Obračunani DDV 22 % od prodaje v državi</li>
                            <li><span class="analitika-code">2601</span> – Obračunani DDV 9,5 % od prodaje v državi</li>
                            <li><span class="analitika-code">2602</span> – Obračunani DDV 5 % od prodaje v državi</li>
                            <li><span class="analitika-code">2603</span> – Obračunani DDV od prejetih avansov</li>
                            <li><span class="analitika-code">2604</span> – Obračunani DDV od samoobdavčitve (EU pridobitve in 76.a člen)</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">290</td>
                    <td class="konto-name">Vnaprej vračunani stroški (PČR)</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">2900</span> – Vnaprej vračunani stroški revizije in računovodstva</li>
                            <li><span class="analitika-code">2901</span> – Vnaprej vračunani neizkoriščeni dopusti</li>
                        </ul>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    <!-- RAZRED 3 -->
    <div class="class-section">
        <div class="class-title">RAZRED 3: Proizvodnja, nedokončana proizvodnja in storitve</div>
        <table>
            <thead>
                <tr>
                    <th style="width: 70px;">Konto</th>
                    <th style="width: 240px;">Sintetika</th>
                    <th>Analitični konti</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="konto-code">300</td>
                    <td class="konto-name">Direktni stroški materiala v proizvodnji</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">3000</span> – Direktni material po proizvodnih nalogih</li>
                            <li><span class="analitika-code">3001</span> – Direktna embalaža v proizvodnji</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">301</td>
                    <td class="konto-name">Direktni stroški dela v proizvodnji</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">3010</span> – Neto plače in prispevki proizvodnih delavcev po nalogih</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">309</td>
                    <td class="konto-name">Splošni proizvodni stroški (SPS)</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">3090</span> – Posredni material v proizvodnji</li>
                            <li><span class="analitika-code">3091</span> – Amortizacija proizvodnih strojev in objektov</li>
                            <li><span class="analitika-code">3092</span> – Storitve vzdrževanja proizvodne opreme</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">310</td>
                    <td class="konto-name">Nedokončana proizvodnja</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">3100</span> – Polizdelki v delovnem procesu</li>
                            <li><span class="analitika-code">3101</span> – Nedokončani izdelki po vrednosti neposrednih stroškov</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">320</td>
                    <td class="konto-name">Nedokončane storitve</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">3200</span> – Nedokončane storitve v teku (po stroškovni vrednosti)</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">350</td>
                    <td class="konto-name">Proizvodi in storitve za lastne potrebe</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">3500</span> – Usredstveni lastni proizvodi</li>
                            <li><span class="analitika-code">3501</span> – Lastne storitve za naložbene namene</li>
                        </ul>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    <!-- RAZRED 4 -->
    <div class="class-section">
        <div class="class-title">RAZRED 4: Stroški po vrstah</div>
        <table>
            <thead>
                <tr>
                    <th style="width: 70px;">Konto</th>
                    <th style="width: 240px;">Sintetika</th>
                    <th>Analitični konti</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="konto-code">400</td>
                    <td class="konto-name">Poraba surovin in materiala</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">4000</span> – Stroški porabljenega osnovnega materiala</li>
                            <li><span class="analitika-code">4001</span> – Stroški porabljene embalaže</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">401</td>
                    <td class="konto-name">Pomožni in pisarniški material</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">4010</span> – Pisarniški material in strokovna literatura</li>
                            <li><span class="analitika-code">4011</span> – Pomožni material za vzdrževanje in čiščenje</li>
                            <li><span class="analitika-code">4012</span> – Drobni inventar (do 1 leta)</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">402</td>
                    <td class="konto-name">Stroški energije</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">4020</span> – Stroški električne energije</li>
                            <li><span class="analitika-code">4021</span> – Stroški ogrevanja (plin, olje, daljinsko)</li>
                            <li><span class="analitika-code">4022</span> – Gorivo za tovorni park in mehanizacijo</li>
                            <li><span class="analitika-code">4023</span> – Gorivo za službena vozila</li>
                            <li><span class="analitika-code">4024</span> – Komunalne storitve in odvoz odpadkov</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">410</td>
                    <td class="konto-name">Transportne in pretovorne storitve</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">4100</span> – Prevozne storitve pri nabavi</li>
                            <li><span class="analitika-code">4101</span> – Prevozne storitve pri prodaji</li>
                            <li><span class="analitika-code">4102</span> – Poštne in kurirske storitve</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">411</td>
                    <td class="konto-name">Storitve vzdrževanja</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">4110</span> – Vzdrževanje poslovnih objektov</li>
                            <li><span class="analitika-code">4111</span> – Vzdrževanje strojev in opreme</li>
                            <li><span class="analitika-code">4112</span> – Vzdrževanje in servis vozil</li>
                            <li><span class="analitika-code">4113</span> – Vzdrževanje IT opreme in licenčne podpore</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">412</td>
                    <td class="konto-name">Najemnine in zakupnine</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">4120</span> – Najemnine za poslovne prostore</li>
                            <li><span class="analitika-code">4121</span> – Najem opreme, orodij in vozil</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">413</td>
                    <td class="konto-name">Stroški povračil zaposlenim</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">4130</span> – Dnevnice za službena potovanja v državi</li>
                            <li><span class="analitika-code">4131</span> – Dnevnice za službena potovanja v tujini</li>
                            <li><span class="analitika-code">4132</span> – Stroški prenočišč na službenih poteh</li>
                            <li><span class="analitika-code">4133</span> – Kilometrina za uporabo lastnega vozila</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">415</td>
                    <td class="konto-name">Intelektualne in osebne storitve</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">4150</span> – Računovodske storitve</li>
                            <li><span class="analitika-code">4151</span> – Pravne, revizorske in svetovalne storitve</li>
                            <li><span class="analitika-code">4152</span> – Storitve varovanja in čiščenja</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">416</td>
                    <td class="konto-name">Reklama in reprezentanca</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">4160</span> – Oglaševanje, sejmi in promocije</li>
                            <li><span class="analitika-code">4161</span> – Reprezentanca (pogostitve, darila)</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">419</td>
                    <td class="konto-name">Bančne storitve in zavarovanja</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">4190</span> – Zavarovalne premije za premoženje</li>
                            <li><span class="analitika-code">4191</span> – Zavarovalne premije za vozila</li>
                            <li><span class="analitika-code">4192</span> – Bančne provizije in stroški PP</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">430-432</td>
                    <td class="konto-name">Amortizacija</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">4310</span> – Amortizacija zgradb</li>
                            <li><span class="analitika-code">4320</span> – Amortizacija opreme in računalnikov</li>
                            <li><span class="analitika-code">4321</span> – Amortizacija vozil</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">440-443</td>
                    <td class="konto-name">Stroški dela</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">4400</span> – Bruto plače zaposlenih (I. bruto)</li>
                            <li><span class="analitika-code">4410</span> – Nadomestila plač v breme podjetja</li>
                            <li><span class="analitika-code">4420</span> – Prispevki delodajalca na plače (II. bruto – 16,10 %)</li>
                            <li><span class="analitika-code">4430</span> – Prehrana med delom</li>
                            <li><span class="analitika-code">4431</span> – Prevoz na delo in z dela</li>
                            <li><span class="analitika-code">4432</span> – Regres za letni dopust</li>
                            <li><span class="analitika-code">4433</span> – Jubilejne nagrade in odpravnine</li>
                        </ul>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    <!-- RAZRED 5 -->
    <div class="class-section">
        <div class="class-title">RAZRED 5: Proizvajalni stroški, stroški prodaje in upravljanja</div>
        <table>
            <thead>
                <tr>
                    <th style="width: 70px;">Konto</th>
                    <th style="width: 240px;">Sintetika</th>
                    <th>Analitični konti</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="konto-code">500</td>
                    <td class="konto-name">Proizvajalni stroški prodanih količin</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">5000</span> – Proizvajalni stroški prodanih izdelkov</li>
                            <li><span class="analitika-code">5001</span> – Stroški opravljenih in prodanih storitev</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">510</td>
                    <td class="konto-name">Stroški prodajanja</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">5100</span> – Stroški skladiščenja in pakiranja izdelkov</li>
                            <li><span class="analitika-code">5101</span> – Transportni stroški pri prodaji</li>
                            <li><span class="analitika-code">5102</span> – Stroški prodajnega osebja</li>
                            <li><span class="analitika-code">5103</span> – Marketinške kampanje in sejmi</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">520</td>
                    <td class="konto-name">Stroški splošnih dejavnosti (Uprava)</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">5200</span> – Stroški vodstva podjetja in splošnih služb</li>
                            <li><span class="analitika-code">5201</span> – Računovodstvo, pravne in kadrovske storitve</li>
                            <li><span class="analitika-code">5202</span> – IT podpora in upravna infrastruktura</li>
                            <li><span class="analitika-code">5203</span> – Amortizacija upravnih prostorov in opreme</li>
                        </ul>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    <!-- RAZRED 6 -->
    <div class="class-section">
        <div class="class-title">RAZRED 6: Zaloge materiala, proizvodov in blaga</div>
        <table>
            <thead>
                <tr>
                    <th style="width: 70px;">Konto</th>
                    <th style="width: 240px;">Sintetika</th>
                    <th>Analitični konti</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="konto-code">600</td>
                    <td class="konto-name">Material v skladišču</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">6000</span> – Surovine in osnovni material</li>
                            <li><span class="analitika-code">6001</span> – Pomožni material</li>
                            <li><span class="analitika-code">6002</span> – Rezervni deli</li>
                            <li><span class="analitika-code">6008</span> – Odstopanja od stalenih cen materiala</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">650</td>
                    <td class="konto-name">Proizvodi v skladišču</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">6500</span> – Gotovi izdelki po proizvajalnih stroških / stalenih cenah</li>
                            <li><span class="analitika-code">6508</span> – Odstopanje od stalenih cen proizvodov</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">660</td>
                    <td class="konto-name">Blago v skladišču (Veleprodaja)</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">6600</span> – Blago po nabavni ceni</li>
                            <li><span class="analitika-code">6601</span> – Odvisni stroški nabave blaga</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">661</td>
                    <td class="konto-name">Blago v trgovini na drobno</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">6610</span> – Blago po prodajni ceni z DDV</li>
                            <li><span class="analitika-code">6618</span> – Vračunana razlika v ceni (marža)</li>
                            <li><span class="analitika-code">6619</span> – Vračunani DDV v zalogi blaga na drobno</li>
                        </ul>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    <!-- RAZRED 7 -->
    <div class="class-section">
        <div class="class-title">RAZRED 7: Prihodki in odhodki</div>
        <table>
            <thead>
                <tr>
                    <th style="width: 70px;">Konto</th>
                    <th style="width: 240px;">Sintetika</th>
                    <th>Analitični konti</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="konto-code">700 / 701</td>
                    <td class="konto-name">Nabavna vrednost prodanega / Proizvajalni stroški</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">7000</span> – Nabavna vrednost prodanega blaga v državi</li>
                            <li><span class="analitika-code">7001</span> – Nabavna vrednost prodanega blaga v tujini</li>
                            <li><span class="analitika-code">7010</span> – Proizvajalni stroški prodanih proizvodov</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">740</td>
                    <td class="konto-name">Finančni odhodki</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">7400</span> – Obresti od bančnih kreditov</li>
                            <li><span class="analitika-code">7401</span> – Zamudne obresti dobaviteljem</li>
                            <li><span class="analitika-code">7420</span> – Negativne tečajne razlike</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">760 / 761</td>
                    <td class="konto-name">Prihodki od prodaje</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">7600</span> – Prodaja izdelkov na domačem trgu</li>
                            <li><span class="analitika-code">7601</span> – Prodaja storitev na domačem trgu</li>
                            <li><span class="analitika-code">7610</span> – Prodaja izdelkov v EU</li>
                            <li><span class="analitika-code">7611</span> – Prodaja storitev v EU ali tretjih državah</li>
                            <li><span class="analitika-code">7620</span> – Prodaja blaga na domačem trgu</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">768</td>
                    <td class="konto-name">Drugi poslovni prihodki</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">7680</span> – Državne podpore in subvencije</li>
                            <li><span class="analitika-code">7681</span> – Prihodki od odškodnin iz zavarovanj</li>
                            <li><span class="analitika-code">7682</span> – Naknadni popusti in bonifikacije dobaviteljev</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">771 / 772</td>
                    <td class="konto-name">Finančni prihodki</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">7710</span> – Obresti na depozite in TRR</li>
                            <li><span class="analitika-code">7720</span> – Pozitivne tečajne razlike</li>
                        </ul>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    <!-- RAZRED 8 -->
    <div class="class-section">
        <div class="class-title">RAZRED 8: Dolgoročne obveznosti, kapital in rezerve</div>
        <table>
            <thead>
                <tr>
                    <th style="width: 70px;">Konto</th>
                    <th style="width: 240px;">Sintetika</th>
                    <th>Analitični konti</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="konto-code">800</td>
                    <td class="konto-name">Dolgoročni bančni krediti</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">8000</span> – Dolgoročni krediti pri domačih bankah</li>
                            <li><span class="analitika-code">8001</span> – Dolgoročni krediti pri tujih bankah</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">801</td>
                    <td class="konto-name">Dolgoročni finančni najem (Leasing)</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">8010</span> – Leasing za opremo in vozila</li>
                            <li><span class="analitika-code">8011</span> – Leasing za nepremičnine</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">830</td>
                    <td class="konto-name">Osnovni kapital</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">8300</span> – Osnovni kapital (vpisani v sodni register)</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">831 / 832</td>
                    <td class="konto-name">Kapitalske rezerve in rezerve iz dobička</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">8310</span> – Vplačani presežek kapitala</li>
                            <li><span class="analitika-code">8320</span> – Zakonske rezerve</li>
                            <li><span class="analitika-code">8321</span> – Statutarne rezerve</li>
                            <li><span class="analitika-code">8323</span> – Druge rezerve iz dobička</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">850 / 860</td>
                    <td class="konto-name">Preneseni poslovni izidi</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">8500</span> – Nerazporejeni dobiček preteklih let</li>
                            <li><span class="analitika-code">8600</span> – Prenesena izguba preteklih let</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">870</td>
                    <td class="konto-name">Poslovni izid obračunskega leta</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">8700</span> – Čisti dobiček obračunskega leta</li>
                            <li><span class="analitika-code">8701</span> – Čista izguba obračunskega leta</li>
                        </ul>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    <!-- RAZRED 9 -->
    <div class="class-section">
        <div class="class-title">RAZRED 9: Obračun poslovnega izida in zunajbilančna evidenca</div>
        <table>
            <thead>
                <tr>
                    <th style="width: 70px;">Konto</th>
                    <th style="width: 240px;">Sintetika</th>
                    <th>Analitični konti</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="konto-code">900</td>
                    <td class="konto-name">Obračun prihodkov in odhodkov</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">9000</span> – Prenos prihodkov na poslovni izid</li>
                            <li><span class="analitika-code">9001</span> – Prenos odhodkov na poslovni izid</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">902</td>
                    <td class="konto-name">Davek iz dobička</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">9020</span> – Obračunani DDPO</li>
                            <li><span class="analitika-code">9021</span> – Odloženi davki</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">903</td>
                    <td class="konto-name">Čisti poslovni izid obdobja</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">9030</span> – Čisti dobiček ali izguba po obdavčitvi</li>
                        </ul>
                    </td>
                </tr>
                <tr>
                    <td class="konto-code">980 / 990</td>
                    <td class="konto-name">Zunajbilančna evidenca</td>
                    <td>
                        <ul class="analitika-list">
                            <li><span class="analitika-code">9800</span> – Tuja sredstva v uporabi ali upravljanju</li>
                            <li><span class="analitika-code">9802</span> – Prejete garancije, menice in hipoteke</li>
                            <li><span class="analitika-code">9900</span> – Obveznosti za tuja sredstva in izdana jamstva</li>
                        </ul>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

</body>
</html>
"""

html_path = "kontni_okvir_srs.html"
pdf_path = "Kontni_okvir_SRS_analitika.pdf"

with open(html_path, "w", encoding="utf-8") as f:
    f.write(html_content)

weasyprint.HTML(filename=html_path).write_pdf(pdf_path)
print(f"PDF uspešno ustvarjen: {pdf_path}")