/**
 * Samodejno ustvarjeno iz Uradnega lista RS št. 81/2024, Priloga 1
 * (Enotni kontni načrt). Ne urejaj ročno; za osvežitev zaženi
 * `pnpm --filter @workspace/api-server run generate:srs-chart`.
 */

export interface OfficialSrs2024SourceAccount {
  code: string;
  name: string;
}

export const OFFICIAL_SRS_2024_SOURCE: readonly OfficialSrs2024SourceAccount[] = [
  {
    "code": "00",
    "name": "NEOPREDMETENA SREDSTVA IN DOLGOROČNE AKTIVNE ČASOVNE RAZMEJITVE"
  },
  {
    "code": "001",
    "name": "DOLGOROČNE AKTIVNE ČASOVNE RAZMEJITVE (dolgoročno odloženi stroški)"
  },
  {
    "code": "002",
    "name": "DOLGOROČNO ODLOŽENI STROŠKI RAZVIJANJA"
  },
  {
    "code": "003",
    "name": "PREMOŽENJSKE PRAVICE"
  },
  {
    "code": "005",
    "name": "DRUGA NEOPREDMETENA SREDSTVA"
  },
  {
    "code": "006",
    "name": "TERJATVE ZA PREDUJME IZ NASLOVA VLAGANJ V NEOPREDMETENA SREDSTVA"
  },
  {
    "code": "007",
    "name": "NEOPREDMETENA DOLGOROČNA SREDSTVA V GRADNJI ALI IZDELAVI"
  },
  {
    "code": "01",
    "name": "POPRAVEK VREDNOSTI NEOPREDMETENIH SREDSTEV"
  },
  {
    "code": "010",
    "name": "POPRAVEK VREDNOSTI NEOPREDMETENIH SREDSTEV"
  },
  {
    "code": "02",
    "name": "NEPREMIČNINE"
  },
  {
    "code": "020",
    "name": "ZEMLJIŠČA"
  },
  {
    "code": "021",
    "name": "ZGRADBE"
  },
  {
    "code": "022",
    "name": "TERJATVE ZA PREDUJME ZA NEPREMIČNINE"
  },
  {
    "code": "023",
    "name": "NEPREMIČNINE V GRADNJI ALI IZDELAVI"
  },
  {
    "code": "029",
    "name": "NEPREMIČNINE TRAJNO ZUNAJ UPORABE"
  },
  {
    "code": "03",
    "name": "POPRAVEK VREDNOSTI ZGRADB"
  },
  {
    "code": "031",
    "name": "POPRAVEK VREDNOSTI ZGRADB"
  },
  {
    "code": "039",
    "name": "POPRAVEK VREDNOSTI ZGRADB TRAJNO ZUNAJ UPORABE"
  },
  {
    "code": "04",
    "name": "OPREMA IN DRUGA OPREDMETENA OSNOVNA SREDSTVA"
  },
  {
    "code": "040",
    "name": "OPREMA"
  },
  {
    "code": "041",
    "name": "DROBNI INVENTAR"
  },
  {
    "code": "042",
    "name": "BIOLOŠKA SREDSTVA"
  },
  {
    "code": "043",
    "name": "VLAGANJA V OPREDMETENA OSNOVNA SREDSTVA V TUJI LASTI"
  },
  {
    "code": "045",
    "name": "DRUGA OPREDMETENA OSNOVNA SREDSTVA"
  },
  {
    "code": "046",
    "name": "TERJATVE ZA PREDUJME ZA OPREMO IN DRUGA OPREDMETENA OSNOVNA SREDSTVA"
  },
  {
    "code": "047",
    "name": "OPREMA IN DRUGA OPREDMETENA OSNOVNA SREDSTVA, KI SE PRIDOBIVAJO"
  },
  {
    "code": "049",
    "name": "OPREMA IN DRUGA OPREDMETENA OSNOVNA SREDSTVA TRAJNO ZUNAJ UPORABE"
  },
  {
    "code": "05",
    "name": "POPRAVEK VREDNOSTI OPREME IN DRUGIH OPREDMETENIH OSNOVNIH SREDSTEV"
  },
  {
    "code": "050",
    "name": "POPRAVEK VREDNOSTI OPREME"
  },
  {
    "code": "051",
    "name": "POPRAVEK VREDNOSTI DROBNEGA INVENTARJA"
  },
  {
    "code": "052",
    "name": "POPRAVEK VREDNOSTI BIOLOŠKIH SREDSTEV"
  },
  {
    "code": "053",
    "name": "POPRAVEK VREDNOSTI VLAGANJ V OPREDMETENA OSNOVNA SREDSTVA V TUJI LASTI"
  },
  {
    "code": "055",
    "name": "POPRAVEK VREDNOSTI DRUGIH OPREDMETENIH OSNOVNIH SREDSTEV POPRAVEK VREDNOSTI OPREME IN DRUGIH OPREDMETENIH OSNOVNIH SREDSTEV"
  },
  {
    "code": "059",
    "name": "TRAJNO ZUNAJ UPORABE"
  },
  {
    "code": "06",
    "name": "DOLGOROČNE FINANČNE NALOŽBE"
  },
  {
    "code": "060",
    "name": "NALOŽBE V DELNICE V DRŽAVI"
  },
  {
    "code": "061",
    "name": "NALOŽBE V DELNICE V TUJINI"
  },
  {
    "code": "062",
    "name": "DRUGE DOLGOROČNE KAPITALSKE NALOŽBE V DRŽAVI"
  },
  {
    "code": "063",
    "name": "DRUGE DOLGOROČNE KAPITALSKE NALOŽBE V TUJINI"
  },
  {
    "code": "065",
    "name": "NALOŽBE V PLEMENITE KOVINE, DRAGE KAMNE, UMETNIŠKA DELA IN PODOBNO"
  },
  {
    "code": "066",
    "name": "NAMENSKO PREMOŽENJE, PRENESENO JAVNIM SKLADOM PREMOŽENJE, PRENESENO V LAST DRUGIM PRAVNIM OSEBAM JAVNEGA PRAVA, KI"
  },
  {
    "code": "067",
    "name": "IMAJO PREMOŽENJE V SVOJI LASTI"
  },
  {
    "code": "068",
    "name": "DRUGE FINANČNE NALOŽBE"
  },
  {
    "code": "069",
    "name": "OSLABITEV VREDNOSTI DOLGOROČNIH FINANČNIH NALOŽB"
  },
  {
    "code": "07",
    "name": "DOLGOROČNO DANA POSOJILA IN DEPOZITI"
  },
  {
    "code": "070",
    "name": "DOLGOROČNO DANA POSOJILA NA PODLAGI POSOJILNIH POGODB V DRŽAVI"
  },
  {
    "code": "071",
    "name": "DOLGOROČNO DANA POSOJILA NA PODLAGI POSOJILNIH POGODB V TUJINO"
  },
  {
    "code": "072",
    "name": "DOLGOROČNO DANA POSOJILA Z ODKUPOM DOMAČIH VREDNOSTNIH PAPIRJEV"
  },
  {
    "code": "073",
    "name": "DOLGOROČNO DANA POSOJILA Z ODKUPOM TUJIH VREDNOSTNIH PAPIRJEV"
  },
  {
    "code": "074",
    "name": "DOLGOROČNO DANI DEPOZITI"
  },
  {
    "code": "075",
    "name": "DRUGA DOLGOROČNO DANA POSOJILA"
  },
  {
    "code": "076",
    "name": "DRUGE DOLGOROČNE OBLIKE DEPOZITOV"
  },
  {
    "code": "079",
    "name": "OSLABITEV VREDNOSTI DOLGOROČNO DANIH POSOJIL"
  },
  {
    "code": "08",
    "name": "DOLGOROČNE TERJATVE IZ POSLOVANJA"
  },
  {
    "code": "080",
    "name": "DOLGOROČNA BLAGOVNA POSOJILA DANA V DRŽAVI"
  },
  {
    "code": "081",
    "name": "DOLGOROČNA BLAGOVNA POSOJILA DANA V TUJINI"
  },
  {
    "code": "085",
    "name": "DRUGE DOLGOROČNE TERJATVE IZ POSLOVANJA"
  },
  {
    "code": "086",
    "name": "DOLGOROČNE TERJATVE IZ NASLOVA FINANČNEGA NAJEMA"
  },
  {
    "code": "089",
    "name": "OSLABITEV VREDNOSTI DOLGOROČNIH TERJATEV IZ POSLOVANJA"
  },
  {
    "code": "09",
    "name": "TERJATVE ZA SREDSTVA DANA V UPRAVLJANJE TERJATVE ZA SREDSTVA DANA V UPRAVLJANJE NEPOSREDNIM UPORABNIKOM"
  },
  {
    "code": "090",
    "name": "PRORAČUNA TERJATVE ZA SREDSTVA DANA V UPRAVLJANJE POSREDNIM UPORABNIKOM"
  },
  {
    "code": "091",
    "name": "PRORAČUNA"
  },
  {
    "code": "10",
    "name": "DENARNA SREDSTVA V BLAGAJNI IN TAKOJ UNOVČLJIVI VREDNOSTNI PAPIRJI"
  },
  {
    "code": "100",
    "name": "DENARNA SREDSTVA V BLAGAJNI"
  },
  {
    "code": "101",
    "name": "DENARNA SREDSTVA V TUJI VALUTI V BLAGAJNI"
  },
  {
    "code": "102",
    "name": "IZDANI ČEKI (ODBITNA POSTAVKA)"
  },
  {
    "code": "103",
    "name": "PREJETI ČEKI"
  },
  {
    "code": "105",
    "name": "DRUGI TAKOJ UNOVČLJIVI VREDNOSTNI PAPIRJI"
  },
  {
    "code": "109",
    "name": "DENAR NA POTI"
  },
  {
    "code": "11",
    "name": "DOBROIMETJE PRI BANKAH IN DRUGIH FINANČNIH USTANOVAH"
  },
  {
    "code": "110",
    "name": "DENARNA SREDSTVA NA RAČUNIH"
  },
  {
    "code": "111",
    "name": "KRATKOROČNI DEPOZITI NA ODPOKLIC"
  },
  {
    "code": "112",
    "name": "DENARNA SREDSTVA V TUJI VALUTI NA RAČUNIH"
  },
  {
    "code": "113",
    "name": "KRATKOROČNI DEVIZNI DEPOZITI NA ODPOKLIC"
  },
  {
    "code": "114",
    "name": "DENARNA SREDSTVA NA POSEBNIH RAČUNIH ZA POSEBNE NAMENE"
  },
  {
    "code": "115",
    "name": "DENARNA SREDSTVA NA DEPOZITNIH RAČUNIH"
  },
  {
    "code": "116",
    "name": "DENARNA SREDSTVA V TUJI VALUTI NA DEPOZITNIH RAČUNIH"
  },
  {
    "code": "12",
    "name": "KRATKOROČNE TERJATVE DO KUPCEV"
  },
  {
    "code": "120",
    "name": "KRATKOROČNE TERJATVE DO KUPCEV V DRŽAVI"
  },
  {
    "code": "121",
    "name": "KRATKOROČNE TERJATVE DO KUPCEV V TUJINI"
  },
  {
    "code": "129",
    "name": "OSLABITEV VREDNOSTI KRATKOROČNIH TERJATEV DO KUPCEV"
  },
  {
    "code": "13",
    "name": "DANI PREDUJMI IN VARŠČINE"
  },
  {
    "code": "130",
    "name": "KRATKOROČNO DANI PREDUJMI"
  },
  {
    "code": "131",
    "name": "KRATKOROČNO DANE VARŠČINE"
  },
  {
    "code": "139",
    "name": "OSLABITEV VREDNOSTI DANIH PREDUJMOV IN VARŠČIN"
  },
  {
    "code": "14",
    "name": "KRATKOROČNE TERJATVE DO UPORABNIKOV ENOTNEGA KONTNEGA NAČRTA"
  },
  {
    "code": "140",
    "name": "KRATKOROČNE TERJATVE DO NEPOSREDNIH UPORABNIKOV PRORAČUNA DRŽAVE"
  },
  {
    "code": "141",
    "name": "KRATKOROČNE TERJATVE DO NEPOSREDNIH UPORABNIKOV PRORAČUNA OBČINE"
  },
  {
    "code": "142",
    "name": "KRATKOROČNE TERJATVE DO POSREDNIH UPORABNIKOV PRORAČUNA DRŽAVE"
  },
  {
    "code": "143",
    "name": "KRATKOROČNE TERJATVE DO POSREDNIH UPORABNIKOV PRORAČUNA OBČINE"
  },
  {
    "code": "144",
    "name": "KRATKOROČNE TERJATVE DO ZZZS IN ZPIZ KRATKOROČNE TERJATVE UPRAVLJAVCA EZR DO UPORABNIKOV ENOTNEGA"
  },
  {
    "code": "145",
    "name": "KONTNEGA NAČRTA OSLABITEV KRATKOROČNIH TERJATEV DO UPORABNIKOV ENOTNEGA KONTNEGA"
  },
  {
    "code": "149",
    "name": "NAČRTA"
  },
  {
    "code": "15",
    "name": "KRATKOROČNE FINANČNE NALOŽBE"
  },
  {
    "code": "150",
    "name": "KRATKOROČNE FINANČNE NALOŽBE V VREDNOSTNE PAPIRJE"
  },
  {
    "code": "151",
    "name": "KRATKOROČNO DANA POSOJILA"
  },
  {
    "code": "152",
    "name": "KRATKOROČNO DANI DEPOZITI"
  },
  {
    "code": "153",
    "name": "KRATKOROČNE FINANČNE NALOŽBE UPRAVLJAVCA EZR"
  },
  {
    "code": "155",
    "name": "DRUGE KRATKOROČNE FINANČNE NALOŽBE"
  },
  {
    "code": "159",
    "name": "POPRAVEK KRATKOROČNIH FINANČNIH NALOŽB"
  },
  {
    "code": "16",
    "name": "KRATKOROČNE TERJATVE IZ FINANCIRANJA"
  },
  {
    "code": "160",
    "name": "KRATKOROČNE TERJATVE IZ NASLOVA OBRESTI"
  },
  {
    "code": "161",
    "name": "KRATKOROČNE TERJATVE IZ NASLOVA DIVIDEND"
  },
  {
    "code": "162",
    "name": "KRATKOROČNE TERJATVE IZ NASLOVA DELEŽEV V DOBIČKU"
  },
  {
    "code": "163",
    "name": "DRUGE KRATKOROČNE TERJATVE IZ FINANCIRANJA"
  },
  {
    "code": "169",
    "name": "OSLABITEV KRATKOROČNIH TERJATEV IZ FINANCIRANJA"
  },
  {
    "code": "17",
    "name": "DRUGE KRATKOROČNE TERJATVE"
  },
  {
    "code": "170",
    "name": "KRATKOROČNE TERJATVE DO DRŽAVNIH IN DRUGIH INSTITUCIJ"
  },
  {
    "code": "174",
    "name": "TERJATVE ZA VSTOPNI DAVEK NA DODANO VREDNOST"
  },
  {
    "code": "175",
    "name": "OSTALE KRATKOROČNE TERJATVE"
  },
  {
    "code": "176",
    "name": "TERJATVE DO ZAVEZANCEV ZA DAVČNE PRIHODKE"
  },
  {
    "code": "177",
    "name": "TERJATVE DO ZAVEZANCEV ZA NEDAVČNE PRIHODKE"
  },
  {
    "code": "179",
    "name": "OSLABITEV DRUGIH KRATKOROČNIH TERJATEV"
  },
  {
    "code": "18",
    "name": "NEPLAČANI ODHODKI"
  },
  {
    "code": "180",
    "name": "NEPLAČANI TEKOČI ODHODKI"
  },
  {
    "code": "181",
    "name": "NEPLAČANI TEKOČI TRANSFERI"
  },
  {
    "code": "182",
    "name": "NEPLAČANI INVESTICIJSKI ODHODKI"
  },
  {
    "code": "183",
    "name": "NEPLAČANI INVESTICIJSKI TRANSFERI"
  },
  {
    "code": "189",
    "name": "NEPLAČANI IZDATKI"
  },
  {
    "code": "19",
    "name": "AKTIVNE ČASOVNE RAZMEJITVE"
  },
  {
    "code": "190",
    "name": "KRATKOROČNO ODLOŽENI ODHODKI"
  },
  {
    "code": "191",
    "name": "PREHODNO NEZARAČUNANI PRIHODKI"
  },
  {
    "code": "192",
    "name": "VREDNOTNICE"
  },
  {
    "code": "193",
    "name": "VRAČUNANI PRIHODKI ZARADI PODALJŠANJA PRORAČUNSKEGA LETA"
  },
  {
    "code": "194",
    "name": "PREHODNO NEZARAČUNANI PRIHODKI ZA PREJETE PREDUJME"
  },
  {
    "code": "195",
    "name": "VRAČUNANI IZDATKI ZARADI PODALJŠANJA PRORAČUNSKEGA LETA"
  },
  {
    "code": "199",
    "name": "DRUGE AKTIVNE ČASOVNE RAZMEJITVE"
  },
  {
    "code": "20",
    "name": "KRATKOROČNE OBVEZNOSTI ZA PREJETE PREDUJME IN VARŠČINE"
  },
  {
    "code": "200",
    "name": "KRATKOROČNE OBVEZNOSTI ZA PREJETE PREDUJME"
  },
  {
    "code": "201",
    "name": "KRATKOROČNE OBVEZNOSTI ZA PREJETE VARŠČINE"
  },
  {
    "code": "21",
    "name": "KRATKOROČNE OBVEZNOSTI DO ZAPOSLENIH"
  },
  {
    "code": "210",
    "name": "OBVEZNOSTI ZA NETO PLAČE IN NADOMESTILA PLAČ"
  },
  {
    "code": "212",
    "name": "OBVEZNOSTI ZA PRISPEVKE IZ BRUTO PLAČ IN NADOMESTIL PLAČ"
  },
  {
    "code": "213",
    "name": "OBVEZNOSTI ZA DAVKE IZ BRUTO PLAČ IN NADOMESTIL PLAČ"
  },
  {
    "code": "214",
    "name": "DRUGE KRATKOROČNE OBVEZNOSTI DO ZAPOSLENIH OBVEZNOSTI ZA PRISPEVKE IZ DRUGIH PREJEMKOV, KI SE NE OBRAČUNAVAJO"
  },
  {
    "code": "215",
    "name": "SKUPAJ S PLAČAMI OBVEZNOSTI ZA DAVKE IZ DRUGIH PREJEMKOV, KI SE NE OBRAČUNAVAJO SKUPAJ S"
  },
  {
    "code": "216",
    "name": "PLAČAMI"
  },
  {
    "code": "22",
    "name": "KRATKOROČNE OBVEZNOSTI DO DOBAVITELJEV"
  },
  {
    "code": "220",
    "name": "KRATKOROČNE OBVEZNOSTI DO DOBAVITELJEV V DRŽAVI"
  },
  {
    "code": "221",
    "name": "KRATKOROČNE OBVEZNOSTI DO DOBAVITELJEV V TUJINI"
  },
  {
    "code": "222",
    "name": "KRATKOROČNE OBVEZNOSTI ZA NEZARAČUNANO BLAGO IN STORITVE"
  },
  {
    "code": "223",
    "name": "KRATKOROČNI BLAGOVNI KREDITI, PREJETI V DRŽAVI"
  },
  {
    "code": "224",
    "name": "KRATKOROČNI BLAGOVNI KREDITI, PREJETI V TUJINI"
  },
  {
    "code": "23",
    "name": "DRUGE KRATKOROČNE OBVEZNOSTI IZ POSLOVANJA"
  },
  {
    "code": "230",
    "name": "KRATKOROČNE OBVEZNOSTI ZA DAJATVE"
  },
  {
    "code": "231",
    "name": "OBVEZNOSTI ZA DAVEK NA DODANO VREDNOST KRATKOROČNE OBVEZNOSTI NA PODLAGI IZDANIH MENIC IN DRUGIH PLAČILNIH"
  },
  {
    "code": "233",
    "name": "INSTRUMENTOV"
  },
  {
    "code": "234",
    "name": "OSTALE KRATKOROČNE OBVEZNOSTI IZ POSLOVANJA"
  },
  {
    "code": "235",
    "name": "OBVEZNOSTI NA PODLAGI ODTEGLJAJEV OD PREJEMKOV ZAPOSLENIH"
  },
  {
    "code": "236",
    "name": "OBVEZNOSTI DO ZAVEZANCEV ZA DAVČNE DAJATVE"
  },
  {
    "code": "237",
    "name": "OBVEZNOSTI DO ZAVEZANCEV ZA NEDAVČNE DAJATVE"
  },
  {
    "code": "24",
    "name": "KRATKOROČNE OBVEZNOSTI DO UPORABNIKOV ENOTNEGA KONTNEGA NAČRTA"
  },
  {
    "code": "240",
    "name": "KRATKOROČNE OBVEZNOSTI DO NEPOSREDNIH UPORABNIKOV PRORAČUNA DRŽAVE"
  },
  {
    "code": "241",
    "name": "KRATKOROČNE OBVEZNOSTI DO NEPOSREDNIH UPORABNIKOV PRORAČUNA OBČINE"
  },
  {
    "code": "242",
    "name": "KRATKOROČNE OBVEZNOSTI DO POSREDNIH UPORABNIKOV PRORAČUNA DRŽAVE"
  },
  {
    "code": "243",
    "name": "KRATKOROČNE OBVEZNOSTI DO POSREDNIH UPORABNIKOV PRORAČUNA OBČINE"
  },
  {
    "code": "244",
    "name": "KRATKOROČNE OBVEZNOSTI DO ZZZS IN ZPIZ KRATKOROČNE OBVEZNOSTI UPRAVLJAVCA EZR DO UPORABNIKOV ENOTNEGA"
  },
  {
    "code": "245",
    "name": "KONTNEGA NAČRTA"
  },
  {
    "code": "25",
    "name": "KRATKOROČNE OBVEZNOSTI DO FINANCERJEV"
  },
  {
    "code": "250",
    "name": "KRATKOROČNI KREDITI, PREJETI V DRŽAVI"
  },
  {
    "code": "251",
    "name": "KRATKOROČNI KREDITI, PREJETI IZ TUJINE"
  },
  {
    "code": "252",
    "name": "OBVEZNOSTI IZ KRATKOROČNO IZDANIH VREDNOSTNIH PAPIRJEV"
  },
  {
    "code": "26",
    "name": "KRATKOROČNE OBVEZNOSTI IZ FINANCIRANJA"
  },
  {
    "code": "260",
    "name": "KRATKOROČNE OBVEZNOSTI IZ FINANCIRANJA"
  },
  {
    "code": "28",
    "name": "NEPLAČANI PRIHODKI"
  },
  {
    "code": "280",
    "name": "NEPLAČANI DAVČNI PRIHODKI"
  },
  {
    "code": "281",
    "name": "NEPLAČANI NEDAVČNI PRIHODKI"
  },
  {
    "code": "282",
    "name": "NEPLAČANI KAPITALSKI PRIHODKI"
  },
  {
    "code": "283",
    "name": "NEPLAČANE PREJETE DONACIJE"
  },
  {
    "code": "284",
    "name": "NEPLAČANI TRANSFERNI PRIHODKI"
  },
  {
    "code": "285",
    "name": "NEPLAČANI PREJEMKI"
  },
  {
    "code": "29",
    "name": "PASIVNE ČASOVNE RAZMEJITVE"
  },
  {
    "code": "290",
    "name": "VNAPREJ VRAČUNANI ODHODKI"
  },
  {
    "code": "291",
    "name": "KRATKOROČNO ODLOŽENI PRIHODKI"
  },
  {
    "code": "292",
    "name": "VNAPREJ VRAČUNANI ODHODKI ZA OBRATNA SREDSTVA"
  },
  {
    "code": "293",
    "name": "VRAČUNANI ODHODKI ZARADI PODALJŠANJA PRORAČUNSKEGA LETA"
  },
  {
    "code": "294",
    "name": "PREHODNO OBRAČUNANI ODHODKI ZA DANE PREDUJME"
  },
  {
    "code": "299",
    "name": "DRUGE PASIVNE ČASOVNE RAZMEJITVE"
  },
  {
    "code": "30",
    "name": "OBRAČUN NABAVE MATERIALA"
  },
  {
    "code": "300",
    "name": "VREDNOST MATERIALA PO OBRAČUNIH DOBAVITELJEV"
  },
  {
    "code": "301",
    "name": "ODVISNI STROŠKI NABAVE MATERIALA"
  },
  {
    "code": "302",
    "name": "DRUGI STROŠKI NABAVE MATERIALA"
  },
  {
    "code": "309",
    "name": "OBRAČUN NABAVE MATERIALA"
  },
  {
    "code": "31",
    "name": "ZALOGE MATERIALA"
  },
  {
    "code": "310",
    "name": "MATERIAL V SKLADIŠČU"
  },
  {
    "code": "311",
    "name": "MATERIAL V OBDELAVI, DODELAVI IN NA POTI"
  },
  {
    "code": "319",
    "name": "ODMIKI OD CEN ZALOG MATERIALA"
  },
  {
    "code": "32",
    "name": "ZALOGE DROBNEGA INVENTARJA IN EMBALAŽE"
  },
  {
    "code": "320",
    "name": "ZALOGE DROBNEGA INVENTARJA IN EMBALAŽE V SKLADIŠČU"
  },
  {
    "code": "321",
    "name": "ZALOGE DROBNEGA INVENTARJA IN EMBALAŽE V UPORABI"
  },
  {
    "code": "329",
    "name": "ODMIKI OD CEN DROBNEGA INVENTARJA IN EMBALAŽE"
  },
  {
    "code": "33",
    "name": "NEDOKONČANA PROIZVODNJA"
  },
  {
    "code": "330",
    "name": "NEDOKONČANI PROIZVODI"
  },
  {
    "code": "332",
    "name": "POLIZDELKI"
  },
  {
    "code": "333",
    "name": "USTAVLJENA NEDOKONČANA PROIZVODNJA"
  },
  {
    "code": "334",
    "name": "PROIZVODNJA V DODELAVI, PREDELAVI IN OBDELAVI"
  },
  {
    "code": "339",
    "name": "ODMIKI OD CEN PROIZVODNJE"
  },
  {
    "code": "34",
    "name": "PROIZVODI"
  },
  {
    "code": "340",
    "name": "PROIZVODI V LASTNEM SKLADIŠČU"
  },
  {
    "code": "341",
    "name": "PROIZVODI V TUJEM SKLADIŠČU"
  },
  {
    "code": "342",
    "name": "PROIZVODI V LASTNI PRODAJALNI"
  },
  {
    "code": "343",
    "name": "VRAČUNANI DAVKI OD PROIZVODOV V PRODAJALNI"
  },
  {
    "code": "344",
    "name": "PROIZVODI V DODELAVI, OBDELAVI IN MANIPULACIJI"
  },
  {
    "code": "349",
    "name": "ODMIKI OD CEN PROIZVODOV"
  },
  {
    "code": "35",
    "name": "OBRAČUN NABAVE BLAGA"
  },
  {
    "code": "350",
    "name": "VREDNOST BLAGA PO OBRAČUNIH DOBAVITELJEV"
  },
  {
    "code": "351",
    "name": "ODVISNI STROŠKI NABAVE BLAGA"
  },
  {
    "code": "359",
    "name": "OBRAČUN NABAVE BLAGA"
  },
  {
    "code": "36",
    "name": "ZALOGE BLAGA"
  },
  {
    "code": "360",
    "name": "BLAGO V LASTNEM SKLADIŠČU"
  },
  {
    "code": "361",
    "name": "BLAGO V TUJEM SKLADIŠČU"
  },
  {
    "code": "363",
    "name": "BLAGO V PRODAJALNI"
  },
  {
    "code": "364",
    "name": "VRAČUNANI DAVEK V ZALOGAH BLAGA"
  },
  {
    "code": "369",
    "name": "VRAČUNANA RAZLIKA V CENAH ZALOG BLAGA"
  },
  {
    "code": "37",
    "name": "DRUGE ZALOGE"
  },
  {
    "code": "370",
    "name": "STAVBNA ZEMLJIŠČA NAMENJENA PRODAJI"
  },
  {
    "code": "371",
    "name": "NEKRATKOROČNA SREDSTVA ZA PRODAJO"
  },
  {
    "code": "372",
    "name": "ZALOGE KOVANCEV V LASTI RS"
  },
  {
    "code": "379",
    "name": "OSTALE ZALOGE NAMENJENE PRODAJI"
  },
  {
    "code": "40",
    "name": "TEKOČI ODHODKI"
  },
  {
    "code": "400",
    "name": "PLAČE IN DRUGI IZDATKI ZAPOSLENIM"
  },
  {
    "code": "4000",
    "name": "Plače in dodatki"
  },
  {
    "code": "400000",
    "name": "Osnovne plače"
  },
  {
    "code": "400001",
    "name": "Dodatek za delovno dobo in dodatek za stalnost"
  },
  {
    "code": "400002",
    "name": "Dodatki za delo v posebnih pogojih"
  },
  {
    "code": "400003",
    "name": "Položajni dodatek"
  },
  {
    "code": "400004",
    "name": "Drugi dodatki"
  },
  {
    "code": "4001",
    "name": "Regres za letni dopust"
  },
  {
    "code": "400100",
    "name": "Regres za letni dopust"
  },
  {
    "code": "4002",
    "name": "Povračila in nadomestila"
  },
  {
    "code": "400200",
    "name": "Dodatki za ločeno življenje"
  },
  {
    "code": "400201",
    "name": "Terenski dodatek"
  },
  {
    "code": "400202",
    "name": "Povračilo stroškov prehrane med delom"
  },
  {
    "code": "400203",
    "name": "Povračilo stroškov prevoza na delo in iz dela"
  },
  {
    "code": "4003",
    "name": "Sredstva za delovno uspešnost"
  },
  {
    "code": "400301",
    "name": "Sredstva za redno delovno uspešnost Sredstva za delovno uspešnost iz naslova povečanega obsega dela pri opravljanju rednih"
  },
  {
    "code": "400302",
    "name": "delovnih nalog Sredstva za delovno uspešnost iz naslova povečanega obsega dela v okviru sodelovanja pri"
  },
  {
    "code": "400303",
    "name": "izvajanju posebnega projekta"
  },
  {
    "code": "400304",
    "name": "Sredstva za delovno uspešnost iz naslova prodaje blaga in storitev na trgu"
  },
  {
    "code": "4004",
    "name": "Sredstva za nadurno delo"
  },
  {
    "code": "400400",
    "name": "Sredstva za nadurno delo"
  },
  {
    "code": "4005",
    "name": "Plače za delo nerezidentov po pogodbi"
  },
  {
    "code": "400500",
    "name": "Plače za delo nerezidentov po pogodbi"
  },
  {
    "code": "4009",
    "name": "Drugi izdatki zaposlenim"
  },
  {
    "code": "400900",
    "name": "Jubilejne nagrade"
  },
  {
    "code": "400901",
    "name": "Odpravnine"
  },
  {
    "code": "400902",
    "name": "Solidarnostne pomoči"
  },
  {
    "code": "400999",
    "name": "Drugi izdatki zaposlenim"
  },
  {
    "code": "401",
    "name": "PRISPEVKI DELODAJALCEV ZA SOCIALNO VARNOST"
  },
  {
    "code": "4010",
    "name": "Prispevek za pokojninsko in invalidsko zavarovanje"
  },
  {
    "code": "401001",
    "name": "Prispevek za pokojninsko in invalidsko zavarovanje"
  },
  {
    "code": "4011",
    "name": "Prispevek za zdravstveno zavarovanje"
  },
  {
    "code": "401100",
    "name": "Prispevek za obvezno zdravstveno zavarovanje"
  },
  {
    "code": "401101",
    "name": "Prispevek za poškodbe pri delu in poklicne bolezni"
  },
  {
    "code": "4012",
    "name": "Prispevek za zaposlovanje"
  },
  {
    "code": "401200",
    "name": "Prispevek za zaposlovanje"
  },
  {
    "code": "4013",
    "name": "Prispevek za starševsko varstvo"
  },
  {
    "code": "401300",
    "name": "Prispevek za starševsko varstvo"
  },
  {
    "code": "4015",
    "name": "Premije kolektivnega dodatnega pokojninskega zavarovanja na podlagi ZKDPZJU"
  },
  {
    "code": "401500",
    "name": "Premije kolektivnega dodatnega pokojninskega zavarovanja na podlagi ZKDPZJU"
  },
  {
    "code": "401510",
    "name": "Druge premije prostovoljnega dodatnega kolektivnega pokojninskega zavarovanja"
  },
  {
    "code": "402",
    "name": "IZDATKI ZA BLAGO IN STORITVE"
  },
  {
    "code": "4020",
    "name": "Pisarniški in splošni material in storitve"
  },
  {
    "code": "402000",
    "name": "Pisarniški material in storitve"
  },
  {
    "code": "402001",
    "name": "Čistilni material in storitve"
  },
  {
    "code": "402002",
    "name": "Storitve varovanja zgradb in prostorov"
  },
  {
    "code": "402003",
    "name": "Založniške in tiskarske storitve ter stroški fotokopiranja"
  },
  {
    "code": "402004",
    "name": "Časopisi, revije, knjige in strokovna literatura"
  },
  {
    "code": "402005",
    "name": "Prevajalske storitve, lektoriranje in podobno"
  },
  {
    "code": "402006",
    "name": "Oglaševalske storitve in objave"
  },
  {
    "code": "402007",
    "name": "Računalniške storitve"
  },
  {
    "code": "402008",
    "name": "Računovodske, revizorske in svetovalne storitve"
  },
  {
    "code": "402009",
    "name": "Reprezentanca"
  },
  {
    "code": "402010",
    "name": "Hrana, storitve menz in restavracij"
  },
  {
    "code": "402011",
    "name": "Storitve informacijske podpore uporabnikom"
  },
  {
    "code": "402099",
    "name": "Drugi splošni material in storitve"
  },
  {
    "code": "4021",
    "name": "Posebni material in storitve"
  },
  {
    "code": "402100",
    "name": "Uniforme in službena obleka"
  },
  {
    "code": "402102",
    "name": "Zdravila, ortopedski pripomočki in sanitetni material"
  },
  {
    "code": "402103",
    "name": "Kmetijski vložki"
  },
  {
    "code": "402105",
    "name": "Material in specialna oprema za policijo"
  },
  {
    "code": "402106",
    "name": "Material za kazensko poboljševalne domove"
  },
  {
    "code": "402107",
    "name": "Laboratorijski materiali"
  },
  {
    "code": "402108",
    "name": "Drobni inventar"
  },
  {
    "code": "402109",
    "name": "Zaračunljive tiskovine"
  },
  {
    "code": "402110",
    "name": "Storitve železniškega prometa"
  },
  {
    "code": "402111",
    "name": "Zdravniški pregledi zaposlenih in drugih upravičencev"
  },
  {
    "code": "402112",
    "name": "Protokolarna darila, promocijski ogledi, organizacije proslav in podobne storitve"
  },
  {
    "code": "402113",
    "name": "Geodetske storitve, parcelacije, cenitve in druge podobne storitve"
  },
  {
    "code": "402114",
    "name": "Material za vojsko"
  },
  {
    "code": "402199",
    "name": "Drugi posebni materiali in storitve"
  },
  {
    "code": "4022",
    "name": "Energija, voda, komunalne storitve in komunikacije"
  },
  {
    "code": "402200",
    "name": "Električna energija"
  },
  {
    "code": "402201",
    "name": "Poraba kuriv in stroški ogrevanja"
  },
  {
    "code": "402202",
    "name": "Poraba druge energije"
  },
  {
    "code": "402203",
    "name": "Voda in komunalne storitve"
  },
  {
    "code": "402204",
    "name": "Odvoz smeti"
  },
  {
    "code": "402205",
    "name": "Telefon, elektronska pošta"
  },
  {
    "code": "402206",
    "name": "Poštnina in kurirske storitve"
  },
  {
    "code": "402299",
    "name": "Druge storitve komunikacij in komunale"
  },
  {
    "code": "4023",
    "name": "Prevozni stroški in storitve"
  },
  {
    "code": "402300",
    "name": "Goriva in maziva za prevozna sredstva"
  },
  {
    "code": "402301",
    "name": "Vzdrževanje in popravila vozil"
  },
  {
    "code": "402302",
    "name": "Nadomestni deli za vozila"
  },
  {
    "code": "402304",
    "name": "Pristojbina za registracijo vozil"
  },
  {
    "code": "402305",
    "name": "Zavarovalne premije za motorna vozila"
  },
  {
    "code": "402306",
    "name": "Stroški nakupa vinjet, cestnin, kartic javnega prevoza"
  },
  {
    "code": "402307",
    "name": "Stroški selitev"
  },
  {
    "code": "402399",
    "name": "Drugi prevozni in transportni stroški"
  },
  {
    "code": "4024",
    "name": "Stroški službenih potovanj"
  },
  {
    "code": "402400",
    "name": "Dnevnice za službena potovanja v državi"
  },
  {
    "code": "402401",
    "name": "Hotelske in restavracijske storitve v državi"
  },
  {
    "code": "402402",
    "name": "Stroški prevoza v državi"
  },
  {
    "code": "402403",
    "name": "Dnevnice za službena potovanja v tujini"
  },
  {
    "code": "402404",
    "name": "Hotelske in restavracijske storitve v tujini"
  },
  {
    "code": "402405",
    "name": "Stroški prevoza v tujini"
  },
  {
    "code": "402499",
    "name": "Drugi stroški službenih potovanj"
  },
  {
    "code": "4025",
    "name": "Tekoče vzdrževanje"
  },
  {
    "code": "402500",
    "name": "Tekoče vzdrževanje poslovnih objektov"
  },
  {
    "code": "402501",
    "name": "Tekoče vzdrževanje stanovanjskih objektov"
  },
  {
    "code": "402502",
    "name": "Tekoče vzdrževanje počitniških objektov"
  },
  {
    "code": "402503",
    "name": "Tekoče vzdrževanje drugih objektov"
  },
  {
    "code": "402504",
    "name": "Zavarovalne premije za objekte"
  },
  {
    "code": "402510",
    "name": "Tekoče vzdrževanje komunikacijske opreme"
  },
  {
    "code": "402511",
    "name": "Tekoče vzdrževanje druge opreme"
  },
  {
    "code": "402512",
    "name": "Zavarovalne premije za opremo"
  },
  {
    "code": "402513",
    "name": "Tekoče vzdrževanje druge (nelicenčne) programske opreme"
  },
  {
    "code": "402514",
    "name": "Tekoče vzdrževanje licenčne programske opreme"
  },
  {
    "code": "402515",
    "name": "Tekoče vzdrževanje strojne računalniške opreme"
  },
  {
    "code": "402516",
    "name": "Tekoče vzdrževanje operativnega informacijskega okolja"
  },
  {
    "code": "402599",
    "name": "Drugi stroški za tekoče vzdrževanje in zavarovanje"
  },
  {
    "code": "4026",
    "name": "Poslovne najemnine in zakupnine"
  },
  {
    "code": "402600",
    "name": "Najemnine in zakupnine za poslovne objekte"
  },
  {
    "code": "402601",
    "name": "Najemnine in zakupnine za stanovanjske objekte"
  },
  {
    "code": "402602",
    "name": "Najemnine in zakupnine za garaže in parkirne prostore"
  },
  {
    "code": "402603",
    "name": "Najemnine in zakupnine za druge objekte"
  },
  {
    "code": "402604",
    "name": "Najem strojne računalniške opreme"
  },
  {
    "code": "402605",
    "name": "Nadomestilo za uporabo stavbnega zemljišča"
  },
  {
    "code": "402606",
    "name": "Druga nadomestila za uporabo zemljišča"
  },
  {
    "code": "402607",
    "name": "Najem programske računalniške opreme"
  },
  {
    "code": "402608",
    "name": "Najem komunikacijske opreme in podatkovnih vodov"
  },
  {
    "code": "402609",
    "name": "Najem vozil"
  },
  {
    "code": "402699",
    "name": "Druge najemnine, zakupnine in licenčnine"
  },
  {
    "code": "4027",
    "name": "Kazni in odškodnine"
  },
  {
    "code": "402700",
    "name": "Kazni zaradi sodnih postopkov"
  },
  {
    "code": "402701",
    "name": "Odškodnine neupravičeno obsojenim"
  },
  {
    "code": "402702",
    "name": "Odškodnine zaradi sodnih postopkov"
  },
  {
    "code": "402799",
    "name": "Druge odškodnine in kazni"
  },
  {
    "code": "4029",
    "name": "Drugi operativni odhodki"
  },
  {
    "code": "402900",
    "name": "Stroški konferenc, seminarjev in simpozijev"
  },
  {
    "code": "402901",
    "name": "Stroški avtorskih honorarjev"
  },
  {
    "code": "402902",
    "name": "Stroški podjemnih pogodb"
  },
  {
    "code": "402903",
    "name": "Stroški dela preko študentskega servisa"
  },
  {
    "code": "402905",
    "name": "Sejnine in pripadajoča povračila stroškov"
  },
  {
    "code": "402907",
    "name": "Stroški strokovnega izobraževanja zaposlenih"
  },
  {
    "code": "402908",
    "name": "Dodatki poslancem in državnim svetnikom"
  },
  {
    "code": "402909",
    "name": "Stroški sodišč v sodnih postopkih"
  },
  {
    "code": "402910",
    "name": "Stroški dela zaprtih oseb"
  },
  {
    "code": "402912",
    "name": "Posebni davek na določene prejemke"
  },
  {
    "code": "402920",
    "name": "Sodni stroški, storitve odvetnikov, sodnih izvedencev, tolmačev, notarjev in drugih"
  },
  {
    "code": "402921",
    "name": "Članarine v mednarodnih organizacijah"
  },
  {
    "code": "402922",
    "name": "Članarine v domačih neprofitnih institucijah"
  },
  {
    "code": "402923",
    "name": "Druge članarine"
  },
  {
    "code": "402930",
    "name": "Stroški storitev organizacijam, pooblaščenim za plačilni promet"
  },
  {
    "code": "402931",
    "name": "Stroški bančnih storitev"
  },
  {
    "code": "402932",
    "name": "Stroški povezani z zadolževanjem"
  },
  {
    "code": "402934",
    "name": "Stroški storitev FURS"
  },
  {
    "code": "402935",
    "name": "Stroški plačilnega agenta"
  },
  {
    "code": "402936",
    "name": "Stroški kotacije na borzi"
  },
  {
    "code": "402937",
    "name": "Stroški davčnih postopkov"
  },
  {
    "code": "402938",
    "name": "Stroški zunanjih sodelavcev"
  },
  {
    "code": "402939",
    "name": "Stroški strokovnih komisij"
  },
  {
    "code": "402940",
    "name": "Prispevek za vzpodbujanje zaposlovanja invalidov"
  },
  {
    "code": "402941",
    "name": "Stroški izobraževanja s področja informatike"
  },
  {
    "code": "402942",
    "name": "Stroški strokovnega izobraževanja zaposlenih po pogodbah o izobraževanju"
  },
  {
    "code": "402943",
    "name": "Stroški EU sodelavcev"
  },
  {
    "code": "402944",
    "name": "Dajatve na področju odmernih odločb FURS"
  },
  {
    "code": "402945",
    "name": "Davek na nepremičnine"
  },
  {
    "code": "402999",
    "name": "Drugi operativni odhodki"
  },
  {
    "code": "403",
    "name": "PLAČILA DOMAČIH OBRESTI"
  },
  {
    "code": "4030",
    "name": "Plačila obresti od kreditov Banki Slovenije"
  },
  {
    "code": "403000",
    "name": "Plačila obresti od kratkoročnih kreditov Banki Slovenije"
  },
  {
    "code": "4031",
    "name": "Plačila obresti od kreditov bankam"
  },
  {
    "code": "403100",
    "name": "Plačila obresti od kratkoročnih kreditov bankam"
  },
  {
    "code": "403101",
    "name": "Plačila obresti od dolgoročnih kreditov bankam"
  },
  {
    "code": "4032",
    "name": "Plačila obresti od kreditov drugim finančnim institucijam"
  },
  {
    "code": "403200",
    "name": "Plačila obresti od kratkoročnih kreditov drugim finančnim institucijam"
  },
  {
    "code": "403201",
    "name": "Plačila obresti od dolgoročnih kreditov drugim finančnim institucijam"
  },
  {
    "code": "4033",
    "name": "Plačila obresti od kreditov drugim domačim kreditodajalcem"
  },
  {
    "code": "403300",
    "name": "Plačila obresti od kratkoročnih kreditov občinam"
  },
  {
    "code": "403301",
    "name": "Plačila obresti od dolgoročnih kreditov občinam"
  },
  {
    "code": "403304",
    "name": "Plačila obresti od kratkoročnih kreditov javnim skladom"
  },
  {
    "code": "403305",
    "name": "Plačila obresti od dolgoročnih kreditov javnim skladom"
  },
  {
    "code": "403306",
    "name": "Plačila obresti od kratkoročnih kreditov državnemu proračunu"
  },
  {
    "code": "403307",
    "name": "Plačila obresti od dolgoročnih kreditov državnemu proračunu"
  },
  {
    "code": "403308",
    "name": "Plačila obresti od kratkoročnih kreditov drugim domačim kreditodajalcem"
  },
  {
    "code": "403309",
    "name": "Plačila obresti od dolgoročnih kreditov drugim domačim kreditodajalcem"
  },
  {
    "code": "403310",
    "name": "Plačila obresti od kratkoročnih kreditov javnim agencijam in javnim zavodom"
  },
  {
    "code": "403311",
    "name": "Plačila obresti od dolgoročnih kreditov javnim agencijam in javnim zavodom"
  },
  {
    "code": "4034",
    "name": "Plačila obresti od vrednostnih papirjev, izdanih na domačem trgu"
  },
  {
    "code": "403401",
    "name": "Plačila obresti od kratkoročnih vrednostnih papirjev - enomesečne zakladne menice"
  },
  {
    "code": "403402",
    "name": "Plačila obresti od kratkoročnih vrednostnih papirjev - trimesečne zakladne menice"
  },
  {
    "code": "403403",
    "name": "Plačila obresti od kratkoročnih vrednostnih papirjev - šestmesečne zakladne menice"
  },
  {
    "code": "403404",
    "name": "Plačila obresti od kratkoročnih vrednostnih papirjev - dvanajstmesečne zakladne menice"
  },
  {
    "code": "403406",
    "name": "Plačila obresti od kratkoročnih vrednostnih papirjev - devetmesečne zakladne menice"
  },
  {
    "code": "403409",
    "name": "Plačila obresti od drugih kratkoročnih vrednostnih papirjev, izdanih na domačem trgu"
  },
  {
    "code": "403410",
    "name": "Plačila obresti od drugih dolgoročnih vrednostnih papirjev, izdanih na domačem trgu"
  },
  {
    "code": "403411",
    "name": "Obresti od izvedenih finančnih instrumentov"
  },
  {
    "code": "403412",
    "name": "Obresti od poslov začasne prodaje vrednostnih papirjev"
  },
  {
    "code": "4035",
    "name": "Plačila obresti subjektom, vključenim v sistem EZR"
  },
  {
    "code": "403500",
    "name": "Plačila obresti na stanja podračunov EZR subjektom, vključenim v sistem EZR"
  },
  {
    "code": "403510",
    "name": "Plačila obresti na vloge subjektom, vključenim v sistem EZR"
  },
  {
    "code": "404",
    "name": "PLAČILA TUJIH OBRESTI"
  },
  {
    "code": "4040",
    "name": "Plačila obresti od kreditov mednarodnim finančnim institucijam"
  },
  {
    "code": "404000",
    "name": "Plačila obresti od kratkoročnih kreditov mednarodnim finančnim institucijam"
  },
  {
    "code": "404001",
    "name": "Plačila obresti od dolgoročnih kreditov mednarodnim finančnim institucijam"
  },
  {
    "code": "4041",
    "name": "Plačila obresti od kreditov tujim vladam"
  },
  {
    "code": "404100",
    "name": "Plačila obresti od kratkoročnih kreditov tujim vladam"
  },
  {
    "code": "404101",
    "name": "Plačila obresti od dolgoročnih kreditov tujim vladam"
  },
  {
    "code": "4042",
    "name": "Plačila obresti od kreditov tujim bankam in finančnim institucijam"
  },
  {
    "code": "404200",
    "name": "Plačila obresti od kratkoročnih kreditov tujim bankam in finančnim institucijam"
  },
  {
    "code": "404201",
    "name": "Plačila obresti od dolgoročnih kreditov tujim bankam in finančnim institucijam"
  },
  {
    "code": "4043",
    "name": "Plačila obresti od kreditov drugim tujim kreditodajalcem"
  },
  {
    "code": "404300",
    "name": "Plačila obresti od kratkoročnih kreditov drugim tujim kreditodajalcem"
  },
  {
    "code": "404301",
    "name": "Plačila obresti od dolgoročnih kreditov drugim tujim kreditodajalcem"
  },
  {
    "code": "4044",
    "name": "Plačila obresti od vrednostnih papirjev, izdanih na tujih trgih"
  },
  {
    "code": "404400",
    "name": "Plačila obresti od kratkoročnih vrednostnih papirjev, izdanih na tujih trgih"
  },
  {
    "code": "404401",
    "name": "Plačila obresti od dolgoročnih vrednostnih papirjev, izdanih na tujih trgih PRENOS PRORAČUNU PRIPADAJOČEGA DELA REZULTATA POSLOVANJA"
  },
  {
    "code": "405",
    "name": "UPRAVLJAVCA EZR PRETEKLEGA LETA"
  },
  {
    "code": "4050",
    "name": "Prenos proračunu pripadajočega dela rezultata poslovanja upravljavca EZR preteklega leta"
  },
  {
    "code": "405000",
    "name": "Prenos proračunu pripadajočega dela rezultata poslovanja upravljavca EZR preteklega leta"
  },
  {
    "code": "409",
    "name": "REZERVE"
  },
  {
    "code": "4090",
    "name": "Splošna proračunska rezervacija"
  },
  {
    "code": "409000",
    "name": "Splošna proračunska rezervacija"
  },
  {
    "code": "4091",
    "name": "Proračunska rezerva"
  },
  {
    "code": "409100",
    "name": "Proračunska rezerva"
  },
  {
    "code": "4092",
    "name": "Druge rezerve"
  },
  {
    "code": "409299",
    "name": "Druge rezerve"
  },
  {
    "code": "4093",
    "name": "Sredstva za posebne namene"
  },
  {
    "code": "409300",
    "name": "Sredstva proračunskih skladov"
  },
  {
    "code": "4098",
    "name": "Rezervacije za kreditna tveganja v javnih skladih"
  },
  {
    "code": "409800",
    "name": "Rezervacije za kreditna tveganja v javnih skladih"
  },
  {
    "code": "41",
    "name": "TEKOČI TRANSFERI"
  },
  {
    "code": "410",
    "name": "SUBVENCIJE"
  },
  {
    "code": "4100",
    "name": "Subvencije javnim podjetjem"
  },
  {
    "code": "410000",
    "name": "Subvencioniranje cen javnim podjetjem in drugim izvajalcem gospodarskih javnih služb"
  },
  {
    "code": "410001",
    "name": "Subvencioniranje obresti javnim podjetjem"
  },
  {
    "code": "410002",
    "name": "Subvencioniranje prispevkov za socialno varnost javnim podjetjem"
  },
  {
    "code": "410003",
    "name": "Sredstva za preusposabljanje presežnih delavcev v javnih podjetjih"
  },
  {
    "code": "410004",
    "name": "Pokrivanje izgub javnim podjetjem"
  },
  {
    "code": "410005",
    "name": "Sredstva za prestrukturiranje in prenovo proizvodnje v javnih podjetjih"
  },
  {
    "code": "410006",
    "name": "Sredstva za zapiranje proizvodnje v javnih podjetjih"
  },
  {
    "code": "410007",
    "name": "Subvencioniranje glavnic dolga javnih podjetij"
  },
  {
    "code": "410015",
    "name": "Sredstva za izvajanje ekoloških programov v javnih podjetjih"
  },
  {
    "code": "410099",
    "name": "Druge subvencije javnim podjetjem"
  },
  {
    "code": "4101",
    "name": "Subvencije finančnim institucijam"
  },
  {
    "code": "410101",
    "name": "Subvencioniranje obresti finančnim institucijam"
  },
  {
    "code": "410104",
    "name": "Pokrivanje izgub finančnim institucijam"
  },
  {
    "code": "410199",
    "name": "Druge subvencije finančnim institucijam"
  },
  {
    "code": "4102",
    "name": "Subvencije privatnim podjetjem in zasebnikom"
  },
  {
    "code": "410200",
    "name": "Subvencioniranje cen privatnim podjetjem in zasebnikom"
  },
  {
    "code": "410201",
    "name": "Subvencioniranje obresti privatnim podjetjem in zasebnikom"
  },
  {
    "code": "410202",
    "name": "Subvencioniranje prispevkov za socialno varnost privatnim podjetjem"
  },
  {
    "code": "410203",
    "name": "Sredstva za preusposabljanje presežnih delavcev privatnim podjetjem"
  },
  {
    "code": "410204",
    "name": "Pokrivanje izgub privatnim podjetjem"
  },
  {
    "code": "410205",
    "name": "Sredstva za prestrukturiranje in prenovo proizvodnje v privatnih podjetjih"
  },
  {
    "code": "410206",
    "name": "Sredstva za zapiranje proizvodnje v privatnih podjetjih"
  },
  {
    "code": "410207",
    "name": "Regresiranje tekoče proizvodnje v privatnih podjetjih"
  },
  {
    "code": "410208",
    "name": "Sredstva za pripravo brezposelnih na zaposlitev v privatnih podjetjih"
  },
  {
    "code": "410209",
    "name": "Sredstva za preusposabljanje zaposlenih v privatnih podjetjih"
  },
  {
    "code": "410210",
    "name": "Sredstva za zaposlovanje invalidnih oseb v privatnih podjetjih"
  },
  {
    "code": "410211",
    "name": "Sredstva za izvajanje javnih del v privatnih podjetjih"
  },
  {
    "code": "410212",
    "name": "Sredstva za delovna mesta v privatnih podjetjih"
  },
  {
    "code": "410213",
    "name": "Sredstva za spodbujanje izvoznih aktivnosti v privatnih podjetjih"
  },
  {
    "code": "410214",
    "name": "Sredstva za pospeševanje tehnološkega razvoja v privatnih podjetjih"
  },
  {
    "code": "410215",
    "name": "Sredstva za izvajanje ekoloških programov v privatnih podjetjih"
  },
  {
    "code": "410216",
    "name": "Subvencioniranje glavnic dolga privatnim podjetjem"
  },
  {
    "code": "410217",
    "name": "Kompleksne subvencije v kmetijstvu"
  },
  {
    "code": "410218",
    "name": "Subvencioniranje turističnih programov in promocijskih aktivnosti"
  },
  {
    "code": "410219",
    "name": "Subvencioniranje standardov kakovosti"
  },
  {
    "code": "410299",
    "name": "Druge subvencije privatnim podjetjem in zasebnikom"
  },
  {
    "code": "411",
    "name": "TRANSFERI POSAMEZNIKOM IN GOSPODINJSTVOM"
  },
  {
    "code": "4110",
    "name": "Transferi nezaposlenim"
  },
  {
    "code": "411000",
    "name": "Denarno nadomestilo"
  },
  {
    "code": "411001",
    "name": "Denarno nadomestilo v enkratnem znesku"
  },
  {
    "code": "411002",
    "name": "Denarna pomoč"
  },
  {
    "code": "411099",
    "name": "Drugi transferi nezaposlenim"
  },
  {
    "code": "4111",
    "name": "Družinski prejemki in starševska nadomestila"
  },
  {
    "code": "411100",
    "name": "Otroški dodatek"
  },
  {
    "code": "411101",
    "name": "Dodatek za nego otroka"
  },
  {
    "code": "411102",
    "name": "Dodatek za veliko družino"
  },
  {
    "code": "411103",
    "name": "Darilo ob rojstvu otroka"
  },
  {
    "code": "411104",
    "name": "Starševsko nadomestilo"
  },
  {
    "code": "411105",
    "name": "Očetovsko nadomestilo"
  },
  {
    "code": "411106",
    "name": "Nadomestilo za nego in varstvo otroka"
  },
  {
    "code": "411107",
    "name": "Posvojiteljsko nadomestilo"
  },
  {
    "code": "411108",
    "name": "Starševski dodatek"
  },
  {
    "code": "411199",
    "name": "Drugi družinski prejemki"
  },
  {
    "code": "4112",
    "name": "Transferi za zagotavljanje socialne varnosti"
  },
  {
    "code": "411200",
    "name": "Denarni dodatek"
  },
  {
    "code": "411201",
    "name": "Denarne pomoči kot edini vir"
  },
  {
    "code": "411202",
    "name": "Sredstva za varstvo duševno in telesno prizadetih"
  },
  {
    "code": "411203",
    "name": "Zdravstveno zavarovanje prejemnikov edinega vira"
  },
  {
    "code": "411204",
    "name": "Zdravstveno zavarovanje duševno in telesno prizadetih"
  },
  {
    "code": "411205",
    "name": "Varstvo družin vojakov"
  },
  {
    "code": "411210",
    "name": "Dodatki za pomoč in postrežbo"
  },
  {
    "code": "411211",
    "name": "Preživnine"
  },
  {
    "code": "411212",
    "name": "Invalidnine za telesno okvaro"
  },
  {
    "code": "411213",
    "name": "Denarna socialna pomoč"
  },
  {
    "code": "411217",
    "name": "Varstveni dodatek - socialno varstveni prejemek"
  },
  {
    "code": "411218",
    "name": "Dodatki k pokojninam"
  },
  {
    "code": "411219",
    "name": "Letni dodatek k pokojninam"
  },
  {
    "code": "411299",
    "name": "Drugi transferi za zagotavljanje socialne varnosti"
  },
  {
    "code": "4113",
    "name": "Transferi vojnim invalidom, veteranom in žrtvam vojnega nasilja"
  },
  {
    "code": "411300",
    "name": "Varstvo vojnih invalidov"
  },
  {
    "code": "411301",
    "name": "Varstvo vojnih veteranov"
  },
  {
    "code": "411302",
    "name": "Varstvo žrtev vojnega nasilja"
  },
  {
    "code": "411303",
    "name": "Državne priznavalnine"
  },
  {
    "code": "411304",
    "name": "Sredstva za zdraviliško in klimatsko zdravljenje Sredstva iz naslova drugih zakonskih pravic na področju vojnih invalidov, vojnih veteranov in"
  },
  {
    "code": "411305",
    "name": "žrtev vojnega nasilja"
  },
  {
    "code": "411399",
    "name": "Drugi transferi vojnim invalidom, veteranom in žrtvam vojnega nasilja"
  },
  {
    "code": "4114",
    "name": "Pokojnine"
  },
  {
    "code": "411400",
    "name": "Starostne pokojnine"
  },
  {
    "code": "411401",
    "name": "Invalidske pokojnine"
  },
  {
    "code": "411402",
    "name": "Družinske pokojnine"
  },
  {
    "code": "411403",
    "name": "Kmečke pokojnine"
  },
  {
    "code": "411404",
    "name": "Vojaške pokojnine"
  },
  {
    "code": "411410",
    "name": "Vdovske pokojnine"
  },
  {
    "code": "411499",
    "name": "Druge pokojnine"
  },
  {
    "code": "4115",
    "name": "Nadomestila plač"
  },
  {
    "code": "411500",
    "name": "Delna nadomestila"
  },
  {
    "code": "411501",
    "name": "Nadomestila za invalidnost"
  },
  {
    "code": "411502",
    "name": "Začasna nadomestila"
  },
  {
    "code": "411503",
    "name": "Nadomestila za čas poklicne rehabilitacije"
  },
  {
    "code": "411599",
    "name": "Druga nadomestila iz invalidskega zavarovanja"
  },
  {
    "code": "4116",
    "name": "Boleznine"
  },
  {
    "code": "411600",
    "name": "Boleznine izplačane iz obveznega zdravstvenega zavarovanja"
  },
  {
    "code": "411699",
    "name": "Druge boleznine iz obveznega zdravstvenega zavarovanja"
  },
  {
    "code": "4117",
    "name": "Štipendije"
  },
  {
    "code": "411700",
    "name": "Državne štipendije"
  },
  {
    "code": "411701",
    "name": "Kadrovske štipendije"
  },
  {
    "code": "411703",
    "name": "Zoisove štipendije"
  },
  {
    "code": "411704",
    "name": "Nagrada dijaku ali študentu za prispevek k trajnostnemu razvoju"
  },
  {
    "code": "411799",
    "name": "Druge štipendije"
  },
  {
    "code": "4119",
    "name": "Drugi transferi posameznikom"
  },
  {
    "code": "411900",
    "name": "Regresiranje prevozov v šolo"
  },
  {
    "code": "411901",
    "name": "Regresiranje potovanj mladine"
  },
  {
    "code": "411902",
    "name": "Doplačila za šolo v naravi"
  },
  {
    "code": "411903",
    "name": "Regresiranje prehrane učencev in dijakov"
  },
  {
    "code": "411904",
    "name": "Regresiranje študentske prehrane"
  },
  {
    "code": "411905",
    "name": "Regresiranje obrestne mere za kreditiranje študentov"
  },
  {
    "code": "411906",
    "name": "Nezgodno zavarovanje vrhunskih športnikov"
  },
  {
    "code": "411907",
    "name": "Pokojninsko, invalidsko in zdravstveno zavarovanje določenih kategorij prebivalcev"
  },
  {
    "code": "411908",
    "name": "Denarne nagrade in priznanja"
  },
  {
    "code": "411909",
    "name": "Regresiranje oskrbe v domovih"
  },
  {
    "code": "411910",
    "name": "Stroški dnevnic, potnih in drugih stroškov v zvezi z zdravljenjem"
  },
  {
    "code": "411911",
    "name": "Stroški pogrebnin"
  },
  {
    "code": "411912",
    "name": "Stroški posmrtnin"
  },
  {
    "code": "411920",
    "name": "Subvencioniranje stanarin"
  },
  {
    "code": "411921",
    "name": "Plačilo razlike med ceno programov v vrtcih in plačili staršev"
  },
  {
    "code": "411923",
    "name": "Sredstva za sofinanciranje tehničnih pripomočkov invalidom"
  },
  {
    "code": "411999",
    "name": "Drugi transferi posameznikom in gospodinjstvom"
  },
  {
    "code": "412",
    "name": "TRANSFERI NEPRIDOBITNIM ORGANIZACIJAM IN USTANOVAM"
  },
  {
    "code": "4120",
    "name": "Tekoči transferi nepridobitnim organizacijam in ustanovam"
  },
  {
    "code": "412000",
    "name": "Tekoči transferi nepridobitnim organizacijam in ustanovam"
  },
  {
    "code": "413",
    "name": "DRUGI TEKOČI DOMAČI TRANSFERI"
  },
  {
    "code": "4130",
    "name": "Tekoči transferi občinam"
  },
  {
    "code": "413000",
    "name": "Dopolnilna sredstva občinam"
  },
  {
    "code": "413001",
    "name": "Sredstva za celostni razvoj podeželja in obnovo vasi"
  },
  {
    "code": "413002",
    "name": "Sredstva za demografsko ogrožena območja"
  },
  {
    "code": "413003",
    "name": "Sredstva, prenesena drugim občinam"
  },
  {
    "code": "413004",
    "name": "Sredstva, prenesena ožjim delom občin"
  },
  {
    "code": "413005",
    "name": "Sredstva za uravnoteženje razvitosti občin"
  },
  {
    "code": "413099",
    "name": "Drugi tekoči transferi občinam"
  },
  {
    "code": "4131",
    "name": "Tekoči transferi v sklade socialnega zavarovanja"
  },
  {
    "code": "413100",
    "name": "Tekoči transferi sredstev iz državnega proračuna v ZPIZ"
  },
  {
    "code": "413101",
    "name": "Dodatni transferi sredstev iz državnega proračuna v ZPIZ"
  },
  {
    "code": "413102",
    "name": "Plačila prispevka za zdravstveno zavarovanje upokojencev, ki ga plačuje ZPIZ"
  },
  {
    "code": "413106",
    "name": "Plačila prispevka delodajalca za pokojninsko in invalidsko zavarovanje od starševskih nadomestil"
  },
  {
    "code": "413107",
    "name": "Plačila prispevka delodajalca za zdravstveno zavarovanje od starševskih nadomestil Plačila prispevka delodajalca za pokojninsko in invalidsko zavarovanje od nadomestil za čas"
  },
  {
    "code": "413108",
    "name": "brezposelnosti"
  },
  {
    "code": "413109",
    "name": "Plačila prispevka delodajalca za zdravstveno zavarovanje od nadomestil za čas brezposelnosti Plačila prispevka delodajalca za pokojninsko in invalidsko zavarovanje od nadomestil zaradi"
  },
  {
    "code": "413110",
    "name": "bolezenske odsotnosti, ki jih ZZZS neposredno izplačuje upravičencem"
  },
  {
    "code": "413111",
    "name": "odsotnosti, ki jih ZZZS neposredno izplačuje upravičencem Plačilo prispevka delodajalca za zdravstveno zavarovanje zapornikov, ki ga državni proračun"
  },
  {
    "code": "413114",
    "name": "plačuje v ZZZS"
  },
  {
    "code": "413116",
    "name": "Prispevki v ZZZS za zdravstveno zavarovanje oseb, ki jih plačuje država za določene osebe"
  },
  {
    "code": "413150",
    "name": "Plačilo razlike do polne vrednosti zdravstvenih storitev za socialno ogrožene"
  },
  {
    "code": "413199",
    "name": "Drugi tekoči transferi v sklade socialnega zavarovanja"
  },
  {
    "code": "4132",
    "name": "Tekoči transferi v javne sklade"
  },
  {
    "code": "413200",
    "name": "Tekoči transferi v javne sklade"
  },
  {
    "code": "4133",
    "name": "Tekoči transferi v javne zavode"
  },
  {
    "code": "413300",
    "name": "Tekoči transferi v javne zavode za sredstva za plače in druge izdatke zaposlenim"
  },
  {
    "code": "413301",
    "name": "Tekoči transferi v javne zavode za sredstva za prispevke delodajalcev"
  },
  {
    "code": "413302",
    "name": "Tekoči transferi v javne zavode za izdatke za blago in storitve"
  },
  {
    "code": "413303",
    "name": "Tekoči transferi v javne zavode za zdravila"
  },
  {
    "code": "413304",
    "name": "Tekoči transferi v javne zavode za ortopedske pripomočke"
  },
  {
    "code": "413305",
    "name": "Tekoči transferi v javne zavode za cepiva, transfuzijo krvi in sanitetni material Tekoči transferi v javne zavode na podlagi EU zakonodaje in sporazumov o socialnem"
  },
  {
    "code": "413306",
    "name": "zavarovanju"
  },
  {
    "code": "413310",
    "name": "Tekoči transferi v javne zavode za premije kolektivnega dodatnega pokojninskega zavarovanja Dodatni transferi sredstev iz državnega proračuna za stroške plač in nadomestil pripravnikom,"
  },
  {
    "code": "413311",
    "name": "sekundarijem in specializantom"
  },
  {
    "code": "4134",
    "name": "Tekoči transferi v državni proračun"
  },
  {
    "code": "413400",
    "name": "Plačila prispevka delodajalca za zaposlovanje od starševskih nadomestil"
  },
  {
    "code": "413401",
    "name": "Plačila prispevka delodajalca za starševsko varstvo od starševskih nadomestil"
  },
  {
    "code": "413402",
    "name": "Plačila prispevka delodajalca za zaposlovanje od nadomestil za čas brezposelnosti"
  },
  {
    "code": "413403",
    "name": "Plačila prispevka delodajalca za starševsko varstvo od nadomestil za čas brezposelnosti Plačila prispevka delodajalca za zaposlovanje od nadomestil zaradi bolezenske odsotnosti, ki jih"
  },
  {
    "code": "413404",
    "name": "ZZZS neposredno izplačuje upravičencem Plačila prispevka delodajalca za starševsko varstvo od nadomestil zaradi bolezenske odsotnosti,"
  },
  {
    "code": "413405",
    "name": "ki jih ZZZS neposredno izplačuje upravičencem"
  },
  {
    "code": "4135",
    "name": "Tekoča plačila drugim izvajalcem javnih služb, ki niso posredni proračunski uporabniki"
  },
  {
    "code": "413500",
    "name": "Tekoča plačila drugim izvajalcem javnih služb, ki niso posredni proračunski uporabniki"
  },
  {
    "code": "413501",
    "name": "Tekoča plačila drugim izvajalcem javnih služb, ki niso posredni proračunski uporabniki za zdravila Tekoča izplačila drugim izvajalcem javnih služb, ki niso posredni proračunski uporabniki, na"
  },
  {
    "code": "413504",
    "name": "podlagi zakonodaje EU in sporazumov o socialnem zavarovanju Tekoča plačila drugim izvajalcem javnih služb, ki niso posredni proračunski uporabniki za"
  },
  {
    "code": "413502",
    "name": "ortopedske pripomočke Tekoča plačila drugim izvajalcem javnih služb, ki niso posredni proračunski uporabniki za cepiva,"
  },
  {
    "code": "413503",
    "name": "transfuzijo krvi, sanitetni material"
  },
  {
    "code": "4136",
    "name": "Tekoči transferi v javne agencije"
  },
  {
    "code": "413600",
    "name": "Tekoči transferi v javne agencije"
  },
  {
    "code": "414",
    "name": "TEKOČI TRANSFERI V TUJINO"
  },
  {
    "code": "4140",
    "name": "Tekoči transferi mednarodnim institucijam"
  },
  {
    "code": "414000",
    "name": "Tekoči transferi mednarodnim institucijam"
  },
  {
    "code": "4141",
    "name": "Tekoči transferi tujim vladam in vladnim institucijam"
  },
  {
    "code": "414100",
    "name": "Tekoči transferi tujim vladam in vladnim institucijam"
  },
  {
    "code": "4142",
    "name": "Tekoči transferi neprofitnim organizacijam v tujini"
  },
  {
    "code": "414200",
    "name": "Tekoči transferi v tujino za zdravljenje v tujini"
  },
  {
    "code": "414201",
    "name": "Tekoči transferi v tujino, na podlagi EU zakonodaje in sporazumov o socialnem zavarovanju"
  },
  {
    "code": "414299",
    "name": "Tekoči transferi neprofitnim organizacijam v tujini - drugo"
  },
  {
    "code": "4143",
    "name": "Drugi tekoči transferi v tujino"
  },
  {
    "code": "414399",
    "name": "Drugi tekoči transferi v tujino"
  },
  {
    "code": "42",
    "name": "INVESTICIJSKI ODHODKI"
  },
  {
    "code": "420",
    "name": "NAKUP IN GRADNJA OSNOVNIH SREDSTEV"
  },
  {
    "code": "4200",
    "name": "Nakup zgradb in prostorov"
  },
  {
    "code": "420000",
    "name": "Nakup poslovnih stavb"
  },
  {
    "code": "420001",
    "name": "Nakup stanovanjskih zgradb in prostorov"
  },
  {
    "code": "420002",
    "name": "Nakup zgradb in prostorov za počitek in rekreacijo"
  },
  {
    "code": "420070",
    "name": "Nakup nepremičnin - finančni najem"
  },
  {
    "code": "420099",
    "name": "Nakup drugih zgradb in prostorov"
  },
  {
    "code": "4201",
    "name": "Nakup prevoznih sredstev"
  },
  {
    "code": "420170",
    "name": "Nakup prevoznih sredstev - finančni najem"
  },
  {
    "code": "420100",
    "name": "Nakup motornih koles in motorjev"
  },
  {
    "code": "420101",
    "name": "Nakup avtomobilov"
  },
  {
    "code": "420102",
    "name": "Nakup avtobusov in minibusov"
  },
  {
    "code": "420103",
    "name": "Nakup tovornjakov in kombijev"
  },
  {
    "code": "420104",
    "name": "Nakup reševalnih vozil"
  },
  {
    "code": "420105",
    "name": "Nakup helikopterjev in letal"
  },
  {
    "code": "420106",
    "name": "Nakup ladij in čolnov"
  },
  {
    "code": "420199",
    "name": "Nakup drugih prevoznih sredstev"
  },
  {
    "code": "4202",
    "name": "Nakup opreme"
  },
  {
    "code": "420270",
    "name": "Nakup pisarniškega pohištva - finančni najem"
  },
  {
    "code": "420271",
    "name": "Nakup druge opreme - finančni najem"
  },
  {
    "code": "420200",
    "name": "Nakup pisarniškega pohištva"
  },
  {
    "code": "420201",
    "name": "Nakup pisarniške opreme"
  },
  {
    "code": "420202",
    "name": "Nakup strojne računalniške opreme"
  },
  {
    "code": "420203",
    "name": "Nakup stanovanjskega pohištva"
  },
  {
    "code": "420204",
    "name": "Nakup drugega pohištva"
  },
  {
    "code": "420220",
    "name": "Nakup opreme za menze"
  },
  {
    "code": "420221",
    "name": "Nakup laboratorijske opreme"
  },
  {
    "code": "420222",
    "name": "Nakup strežnikov in diskovnih sistemov"
  },
  {
    "code": "420223",
    "name": "Nakup opreme za hlajenje in ogrevanje ter napeljav"
  },
  {
    "code": "420224",
    "name": "Nakup opreme za tiskanje in razmnoževanje"
  },
  {
    "code": "420225",
    "name": "Nakup opreme za nadzor prometa in napeljav"
  },
  {
    "code": "420226",
    "name": "Nakup pristaniške opreme in napeljav"
  },
  {
    "code": "420227",
    "name": "Nakup letališke opreme in instalacij"
  },
  {
    "code": "420228",
    "name": "Nakup kmetijske in gozdarske opreme in mehanizacije"
  },
  {
    "code": "420229",
    "name": "Nakup rudniške opreme in mehanizacije"
  },
  {
    "code": "420230",
    "name": "Nakup opreme za vzdrževanje parkov in vrtov"
  },
  {
    "code": "420231",
    "name": "Nakup opreme in mehanizacije za vzdrževanje vodnega režima"
  },
  {
    "code": "420232",
    "name": "Nakup konstrukcijske opreme"
  },
  {
    "code": "420233",
    "name": "Nakup gasilske opreme"
  },
  {
    "code": "420234",
    "name": "Nakup opreme za proizvodnjo energije"
  },
  {
    "code": "420235",
    "name": "Nakup opreme za čiščenje in pluženje cest"
  },
  {
    "code": "420236",
    "name": "Nakup policijske opreme"
  },
  {
    "code": "420237",
    "name": "Nakup opreme za varovanje"
  },
  {
    "code": "420238",
    "name": "Nakup telekomunikacijske opreme"
  },
  {
    "code": "420239",
    "name": "Nakup avdiovizualne opreme"
  },
  {
    "code": "420240",
    "name": "Nakup medicinske opreme in napeljav"
  },
  {
    "code": "420241",
    "name": "Nakup opreme telovadnic in športnih objektov"
  },
  {
    "code": "420242",
    "name": "Nakup geodetske opreme"
  },
  {
    "code": "420243",
    "name": "Nakup hidrometeorološke opreme"
  },
  {
    "code": "420244",
    "name": "Nakup opreme za učilnice"
  },
  {
    "code": "420245",
    "name": "Nakup opreme za igralnice v vrtcih in za otroška igrišča"
  },
  {
    "code": "420246",
    "name": "Nakup opreme za knjižnice"
  },
  {
    "code": "420247",
    "name": "Nakup opreme za socialne zavode"
  },
  {
    "code": "420248",
    "name": "Nakup aktivne mrežne in komunikacijske opreme"
  },
  {
    "code": "420249",
    "name": "Nakup pasivne mrežne in komunikacijske opreme"
  },
  {
    "code": "420250",
    "name": "Nakup vojaške opreme"
  },
  {
    "code": "420299",
    "name": "Nakup druge opreme in napeljav"
  },
  {
    "code": "4203",
    "name": "Nakup drugih osnovnih sredstev"
  },
  {
    "code": "420300",
    "name": "Nakup drugih osnovnih sredstev"
  },
  {
    "code": "4204",
    "name": "Novogradnje, rekonstrukcije in adaptacije"
  },
  {
    "code": "420400",
    "name": "Priprava zemljišča"
  },
  {
    "code": "420401",
    "name": "Novogradnje"
  },
  {
    "code": "420402",
    "name": "Rekonstrukcije in adaptacije"
  },
  {
    "code": "4205",
    "name": "Investicijsko vzdrževanje in obnove"
  },
  {
    "code": "420500",
    "name": "Investicijsko vzdrževanje in izboljšave"
  },
  {
    "code": "420501",
    "name": "Obnove"
  },
  {
    "code": "4206",
    "name": "Nakup zemljišč in naravnih bogastev"
  },
  {
    "code": "420600",
    "name": "Nakup zemljišč"
  },
  {
    "code": "420601",
    "name": "Nakup gozdov"
  },
  {
    "code": "420603",
    "name": "Pridobivanje mineralov"
  },
  {
    "code": "420604",
    "name": "Pridobitev pravic raziskovanja"
  },
  {
    "code": "420605",
    "name": "Pridobitev pravic do ribolova"
  },
  {
    "code": "420699",
    "name": "Druge pravice do naravnih bogastev"
  },
  {
    "code": "4207",
    "name": "Nakup nematerialnega premoženja"
  },
  {
    "code": "420700",
    "name": "Pridobitev patentov"
  },
  {
    "code": "420701",
    "name": "Pridobitev pravice tiskanja in razmnoževanja"
  },
  {
    "code": "420702",
    "name": "Pridobitev blagovnih znamk"
  },
  {
    "code": "420703",
    "name": "Nakup licenčne programske opreme"
  },
  {
    "code": "420704",
    "name": "Nakup druge (nelicenčne) programske opreme"
  },
  {
    "code": "420770",
    "name": "Nakup neopredmetenih dolgoročnih sredstev - finančni najem"
  },
  {
    "code": "420799",
    "name": "Pridobitev drugih neopredmetenih sredstev"
  },
  {
    "code": "4208",
    "name": "Študije o izvedljivosti projektov, projektna dokumentacija, nadzor in investicijski inženiring"
  },
  {
    "code": "420800",
    "name": "Študija o izvedljivosti projekta"
  },
  {
    "code": "420801",
    "name": "Investicijski nadzor"
  },
  {
    "code": "420802",
    "name": "Investicijski inženiring"
  },
  {
    "code": "420804",
    "name": "Načrti in druga projektna dokumentacija"
  },
  {
    "code": "420805",
    "name": "Plačilo nadomestila za spremembo namembnosti zemljišč"
  },
  {
    "code": "420806",
    "name": "Analize, študije in načrti z informacijskega področja"
  },
  {
    "code": "420899",
    "name": "Plačila drugih storitev in dokumentacije"
  },
  {
    "code": "4209",
    "name": "Nakup blagovnih rezerv in intervencijskih zalog"
  },
  {
    "code": "420900",
    "name": "Nakup mesa"
  },
  {
    "code": "420901",
    "name": "Nakup sladkorja"
  },
  {
    "code": "420902",
    "name": "Nakup žitaric"
  },
  {
    "code": "420903",
    "name": "Nakup goriva"
  },
  {
    "code": "420904",
    "name": "Nakup zdravil, sanitetnega materiala in veterinarskih sredstev"
  },
  {
    "code": "420999",
    "name": "Nakup drugih blagovnih rezerv"
  },
  {
    "code": "43",
    "name": "INVESTICIJSKI TRANSFERI INVESTICIJSKI TRANSFERI PRAVNIM IN FIZIČNIM OSEBAM, KI NISO PRORAČUNSKI"
  },
  {
    "code": "431",
    "name": "UPORABNIKI"
  },
  {
    "code": "4310",
    "name": "Investicijski transferi nepridobitnim organizacijam in ustanovam"
  },
  {
    "code": "431000",
    "name": "Investicijski transferi nepridobitnim organizacijam in ustanovam"
  },
  {
    "code": "4311",
    "name": "Investicijski transferi javnim podjetjem in družbam, ki so v lasti države ali občin"
  },
  {
    "code": "431100",
    "name": "Investicijski transferi javnim podjetjem in družbam, ki so v lasti države ali občin"
  },
  {
    "code": "4312",
    "name": "Investicijski transferi finančnim institucijam"
  },
  {
    "code": "431200",
    "name": "Investicijski transferi finančnim institucijam"
  },
  {
    "code": "4313",
    "name": "Investicijski transferi privatnim podjetjem"
  },
  {
    "code": "431300",
    "name": "Investicijski transferi privatnim podjetjem"
  },
  {
    "code": "4314",
    "name": "Investicijski transferi posameznikom in zasebnikom"
  },
  {
    "code": "431400",
    "name": "Investicijski transferi posameznikom in zasebnikom"
  },
  {
    "code": "4315",
    "name": "Investicijski transferi drugim izvajalcem javnih služb, ki niso posredni proračunski uporabniki"
  },
  {
    "code": "431500",
    "name": "Investicijski transferi drugim izvajalcem javnih služb, ki niso posredni proračunski uporabniki"
  },
  {
    "code": "4316",
    "name": "Investicijski transferi v tujino"
  },
  {
    "code": "431600",
    "name": "Investicijski transferi v tujino"
  },
  {
    "code": "432",
    "name": "INVESTICIJSKI TRANSFERI PRORAČUNSKIM UPORABNIKOM"
  },
  {
    "code": "4320",
    "name": "Investicijski transferi občinam"
  },
  {
    "code": "432000",
    "name": "Investicijski transferi občinam"
  },
  {
    "code": "432001",
    "name": "Investicijski transferi ožjim delom občin"
  },
  {
    "code": "4321",
    "name": "Investicijski transferi javnim skladom in javnim agencijam"
  },
  {
    "code": "432100",
    "name": "Investicijski transferi javnim skladom"
  },
  {
    "code": "432101",
    "name": "Investicijski transferi javnim agencijam"
  },
  {
    "code": "4322",
    "name": "Investicijski transferi v državni proračun"
  },
  {
    "code": "432200",
    "name": "Investicijski transferi v državni proračun"
  },
  {
    "code": "4323",
    "name": "Investicijski transferi javnim zavodom"
  },
  {
    "code": "432300",
    "name": "Investicijski transferi javnim zavodom"
  },
  {
    "code": "44",
    "name": "DANA POSOJILA IN POVEČANJE FINANČNIH NALOŽB"
  },
  {
    "code": "440",
    "name": "DANA POSOJILA"
  },
  {
    "code": "4400",
    "name": "Dana posojila posameznikom in zasebnikom"
  },
  {
    "code": "440000",
    "name": "Dana posojila posameznikom in zasebnikom - kratkoročna posojila"
  },
  {
    "code": "440001",
    "name": "Dana posojila posameznikom in zasebnikom - dolgoročna posojila"
  },
  {
    "code": "4401",
    "name": "Dana posojila javnim skladom"
  },
  {
    "code": "440100",
    "name": "Dana posojila javnim skladom - kratkoročna posojila"
  },
  {
    "code": "440101",
    "name": "Dana posojila javnim skladom - dolgoročna posojila"
  },
  {
    "code": "4402",
    "name": "Dana posojila javnim podjetjem in družbam, ki so v lasti države ali občin"
  },
  {
    "code": "440200",
    "name": "Dana posojila javnim podjetjem in družbam, ki so v lasti države ali občin - kratkoročna posojila"
  },
  {
    "code": "440201",
    "name": "Dana posojila javnim podjetjem in družbam, ki so v lasti države ali občin - dolgoročna posojila"
  },
  {
    "code": "4403",
    "name": "Dana posojila finančnim institucijam"
  },
  {
    "code": "440300",
    "name": "Dana posojila finančnim institucijam - kratkoročna posojila"
  },
  {
    "code": "440301",
    "name": "Dana posojila finančnim institucijam - dolgoročna posojila"
  },
  {
    "code": "4404",
    "name": "Dana posojila privatnim podjetjem"
  },
  {
    "code": "440400",
    "name": "Dana posojila privatnim podjetjem - kratkoročna posojila"
  },
  {
    "code": "440401",
    "name": "Dana posojila privatnim podjetjem - dolgoročna posojila"
  },
  {
    "code": "4405",
    "name": "Dana posojila občinam"
  },
  {
    "code": "440500",
    "name": "Dana posojila občinam - kratkoročna posojila"
  },
  {
    "code": "440501",
    "name": "Dana posojila občinam - dolgoročna posojila"
  },
  {
    "code": "4406",
    "name": "Dana posojila v tujino"
  },
  {
    "code": "440600",
    "name": "Dana posojila v tujino - kratkoročna posojila"
  },
  {
    "code": "440601",
    "name": "Dana posojila v tujino - dolgoročna posojila"
  },
  {
    "code": "4407",
    "name": "Dana posojila državnemu proračunu"
  },
  {
    "code": "440700",
    "name": "Dana posojila državnemu proračunu - kratkoročna posojila"
  },
  {
    "code": "440701",
    "name": "Dana posojila državnemu proračunu - dolgoročna posojila"
  },
  {
    "code": "4408",
    "name": "Dana posojila javnim agencijam in javnim zavodom"
  },
  {
    "code": "440800",
    "name": "Dana posojila javnim agencijam in javnim zavodom - kratkoročna posojila"
  },
  {
    "code": "440801",
    "name": "Dana posojila javnim agencijam in javnim zavodom - dolgoročna posojila"
  },
  {
    "code": "4409",
    "name": "Plačila zapadlih poroštev"
  },
  {
    "code": "440900",
    "name": "Plačila zapadlih poroštev javnim podjetjem in družbam, ki so v lasti države ali občin"
  },
  {
    "code": "440901",
    "name": "Plačila zapadlih poroštev privatnim podjetjem"
  },
  {
    "code": "440902",
    "name": "Plačila zapadlih poroštev finančnim institucijam"
  },
  {
    "code": "440903",
    "name": "Plačila zapadlih poroštev fizičnim osebam"
  },
  {
    "code": "440904",
    "name": "Izplačila starih vlog deviznim varčevalcem"
  },
  {
    "code": "440999",
    "name": "Plačila drugih zapadlih poroštev"
  },
  {
    "code": "441",
    "name": "POVEČANJE FINANČNIH NALOŽB"
  },
  {
    "code": "4410",
    "name": "Povečanje kapitalskih deležev v javnih podjetjih in družbah, ki so v lasti države ali občin"
  },
  {
    "code": "441000",
    "name": "Povečanje kapitalskih deležev v javnih podjetjih in družbah, ki so v lasti države ali občin"
  },
  {
    "code": "4411",
    "name": "Povečanje kapitalskih deležev v finančnih institucijah"
  },
  {
    "code": "441100",
    "name": "Povečanje kapitalskih deležev v finančnih institucijah"
  },
  {
    "code": "4412",
    "name": "Povečanje kapitalskih deležev v privatnih podjetjih"
  },
  {
    "code": "441200",
    "name": "Povečanje kapitalskih deležev v privatnih podjetjih"
  },
  {
    "code": "4413",
    "name": "Skupna vlaganja"
  },
  {
    "code": "441300",
    "name": "Skupna vlaganja"
  },
  {
    "code": "4414",
    "name": "Povečanje kapitalskih deležev v tujino"
  },
  {
    "code": "441400",
    "name": "Povečanje kapitalskih deležev v tujino"
  },
  {
    "code": "4415",
    "name": "Povečanje drugih finančnih naložb"
  },
  {
    "code": "441500",
    "name": "Povečanje drugih finančnih naložb"
  },
  {
    "code": "442",
    "name": "PORABA SREDSTEV KUPNIN IZ NASLOVA PRIVATIZACIJE"
  },
  {
    "code": "4420",
    "name": "Dana posojila iz sredstev kupnin"
  },
  {
    "code": "442000",
    "name": "Dana posojila posameznikom iz sredstev kupnin - kratkoročna posojila"
  },
  {
    "code": "442001",
    "name": "Dana posojila posameznikom iz sredstev kupnin - dolgoročna posojila"
  },
  {
    "code": "442002",
    "name": "Dana posojila javnim podjetjem iz sredstev kupnin - kratkoročna posojila"
  },
  {
    "code": "442003",
    "name": "Dana posojila javnim podjetjem iz sredstev kupnin - dolgoročna posojila"
  },
  {
    "code": "442004",
    "name": "Dana posojila privatnim podjetjem in zasebnikom iz sredstev kupnin - kratkoročna posojila"
  },
  {
    "code": "442005",
    "name": "Dana posojila privatnim podjetjem in zasebnikom iz sredstev kupnin - dolgoročna posojila"
  },
  {
    "code": "4421",
    "name": "Sredstva kupnin, razporejena v javne sklade, javne agencije in finančne družbe"
  },
  {
    "code": "442100",
    "name": "Sredstva kupnin, razporejena v javne sklade in javne agencije"
  },
  {
    "code": "442101",
    "name": "Sredstva kupnin, razporejena v finančne družbe"
  },
  {
    "code": "4422",
    "name": "Povečanje kapitalskih deležev države iz sredstev kupnin"
  },
  {
    "code": "442200",
    "name": "Povečanje kapitalskih deležev države iz sredstev kupnin v javnih podjetjih"
  },
  {
    "code": "442201",
    "name": "Povečanje kapitalskih deležev države iz sredstev kupnin v privatnih podjetjih POVEČANJE NAMENSKEGA PREMOŽENJA V JAVNIH SKLADIH IN DRUGIH PRAVNIH"
  },
  {
    "code": "443",
    "name": "OSEBAH JAVNEGA PRAVA, KI IMAJO PREMOŽENJE V SVOJI LASTI"
  },
  {
    "code": "4430",
    "name": "Povečanje namenskega premoženja v javnih skladih"
  },
  {
    "code": "443000",
    "name": "Povečanje namenskega premoženja v javnih skladih"
  },
  {
    "code": "4431",
    "name": "Povečanje premoženja v drugih pravnih osebah javnega prava, ki je v njihovi lasti"
  },
  {
    "code": "443100",
    "name": "Povečanje premoženja v drugih pravnih osebah javnega prava, ki je v njihovi lasti DANA POSOJILA SUBJEKTOM, VKLJUČENIM V ENOTNO UPRAVLJANJE SREDSTEV"
  },
  {
    "code": "444",
    "name": "SISTEMA EZR"
  },
  {
    "code": "4440",
    "name": "Dana posojila subjektom, vključenim v enotno upravljanje sredstev sistema EZR Dana likvidnostna in kratkoročna posojila subjektom, vključenim v enotno upravljanje sredstev"
  },
  {
    "code": "444000",
    "name": "sistema EZR"
  },
  {
    "code": "444002",
    "name": "Dana dolgoročna posojila subjektom, vključenim v enotno upravljanje sredstev sistema EZR"
  },
  {
    "code": "45",
    "name": "PLAČILA SREDSTEV V PRORAČUN EU"
  },
  {
    "code": "450",
    "name": "PLAČILA SREDSTEV V PRORAČUN EU"
  },
  {
    "code": "4500",
    "name": "Plačila tradicionalnih lastnih sredstev v proračun EU"
  },
  {
    "code": "450000",
    "name": "Plačila sredstev v proračun EU iz naslova carin Plačila sredstev v proračun EU iz naslova nereciklirane plastične embalaže iz državnega"
  },
  {
    "code": "450003",
    "name": "proračuna"
  },
  {
    "code": "4501",
    "name": "Plačila sredstev v proračun EU iz naslova davka na dodano vrednost"
  },
  {
    "code": "450100",
    "name": "Plačila sredstev v proračun EU iz naslova davka na dodano vrednost"
  },
  {
    "code": "4502",
    "name": "Plačila sredstev v proračun EU iz naslova bruto nacionalnega dohodka (BND)"
  },
  {
    "code": "450200",
    "name": "Plačila sredstev v proračun EU iz naslova bruto nacionalnega dohodka (BND)"
  },
  {
    "code": "4503",
    "name": "Plačila sredstev v proračun EU iz naslova popravka v korist Združenega kraljestva"
  },
  {
    "code": "450300",
    "name": "Plačila sredstev v proračun EU iz naslova popravka v korist Združenega kraljestva Plačila sredstev v proračun EU iz naslova popravkov bruto nacionalnega dohodka (BND) v korist"
  },
  {
    "code": "4504",
    "name": "drugih držav Plačila sredstev v proračun EU iz naslova popravkov bruto nacionalnega dohodka (BND) v korist"
  },
  {
    "code": "450400",
    "name": "drugih držav Plačila sredstev v proračun EU iz naslova bruto znižanja letnega prispevka iz naslova bruto"
  },
  {
    "code": "450401",
    "name": "nacionalnega dohodka (BND) v korist nekaterih držav iz državnega proračuna"
  },
  {
    "code": "46",
    "name": "ZARAČUNANI ODHODKI DOLOČENIH UPORABNIKOV ENOTNEGA KONTNEGA NAČRTA"
  },
  {
    "code": "460",
    "name": "STROŠKI MATERIALA"
  },
  {
    "code": "461",
    "name": "STROŠKI STORITEV"
  },
  {
    "code": "462",
    "name": "AMORTIZACIJA"
  },
  {
    "code": "463",
    "name": "REZERVACIJE"
  },
  {
    "code": "464",
    "name": "PLAČE IN NADOMESTILA PLAČ"
  },
  {
    "code": "465",
    "name": "DRUGI STROŠKI"
  },
  {
    "code": "466",
    "name": "STROŠKI PRODANIH ZALOG"
  },
  {
    "code": "467",
    "name": "FINANČNI ODHODKI"
  },
  {
    "code": "468",
    "name": "DRUGI ODHODKI"
  },
  {
    "code": "469",
    "name": "PREVREDNOTOVALNI POSLOVNI ODHODKI"
  },
  {
    "code": "49",
    "name": "PRENOS ODHODKOV IN DRUGIH IZDATKOV"
  },
  {
    "code": "490",
    "name": "PRENOS ODHODKOV IN DRUGIH IZDATKOV"
  },
  {
    "code": "491",
    "name": "PRENOS STROŠKOV NA ZALOGE"
  },
  {
    "code": "497",
    "name": "EVIDENČNI PROMET STROŠKOV IN ODHODKOV REŽIJSKIH OBRATOV"
  },
  {
    "code": "498",
    "name": "EVIDENČNI PROMET ODHODKOV V BREME REZERVNEGA SKLADA EVIDENČNI PROMET ODHODKOV IN DRUGIH IZDATKOV DOLOČENIH UPORABNIKOV"
  },
  {
    "code": "499",
    "name": "ENOTNEGA KONTNEGA NAČRTA"
  },
  {
    "code": "50",
    "name": "ZADOLŽEVANJE"
  },
  {
    "code": "500",
    "name": "DOMAČE ZADOLŽEVANJE"
  },
  {
    "code": "5000",
    "name": "Najeti krediti pri Banki Slovenije"
  },
  {
    "code": "500000",
    "name": "Najeti krediti pri Banki Slovenije - kratkoročni krediti"
  },
  {
    "code": "5001",
    "name": "Najeti krediti pri bankah"
  },
  {
    "code": "500100",
    "name": "Najeti krediti pri bankah - kratkoročni krediti"
  },
  {
    "code": "500101",
    "name": "Najeti krediti pri bankah - dolgoročni krediti"
  },
  {
    "code": "5002",
    "name": "Najeti krediti pri drugih finančnih institucijah"
  },
  {
    "code": "500200",
    "name": "Najeti krediti pri drugih finančnih institucijah - kratkoročni krediti"
  },
  {
    "code": "500201",
    "name": "Najeti krediti pri drugih finančnih institucijah - dolgoročni krediti"
  },
  {
    "code": "5003",
    "name": "Najeti krediti pri drugih domačih kreditodajalcih"
  },
  {
    "code": "500300",
    "name": "Najeti krediti pri občinah - kratkoročni krediti"
  },
  {
    "code": "500301",
    "name": "Najeti krediti pri občinah - dolgoročni krediti"
  },
  {
    "code": "500304",
    "name": "Najeti krediti pri javnih skladih - kratkoročni krediti"
  },
  {
    "code": "500305",
    "name": "Najeti krediti pri javnih skladih - dolgoročni krediti"
  },
  {
    "code": "500306",
    "name": "Najeti krediti pri državnem proračunu - kratkoročni krediti"
  },
  {
    "code": "500307",
    "name": "Najeti krediti pri državnem proračunu - dolgoročni krediti"
  },
  {
    "code": "500308",
    "name": "Najeti krediti pri drugih domačih kreditodajalcih - kratkoročni krediti"
  },
  {
    "code": "500309",
    "name": "Najeti krediti pri drugih domačih kreditodajalcih - dolgoročni krediti"
  },
  {
    "code": "5004",
    "name": "Sredstva, pridobljena z izdajo vrednostnih papirjev na domačem trgu"
  },
  {
    "code": "500401",
    "name": "Izdani kratkoročni vrednostni papirji na domačem trgu - enomesečne zakladne menice"
  },
  {
    "code": "500402",
    "name": "Izdani kratkoročni vrednostni papirji na domačem trgu - trimesečne zakladne menice"
  },
  {
    "code": "500403",
    "name": "Izdani kratkoročni vrednostni papirji na domačem trgu - šestmesečne zakladne menice"
  },
  {
    "code": "500404",
    "name": "Izdani kratkoročni vrednostni papirji na domačem trgu - dvanajstmesečne zakladne menice"
  },
  {
    "code": "500409",
    "name": "Drugi kratkoročni vrednostni papirji, izdani na domačem trgu"
  },
  {
    "code": "500410",
    "name": "Drugi dolgoročni vrednostni papirji, izdani na domačem trgu"
  },
  {
    "code": "500411",
    "name": "Izdani kratkoročni vrednostni papirji na domačem trgu - devetmesečne zakladne menice"
  },
  {
    "code": "501",
    "name": "ZADOLŽEVANJE V TUJINI"
  },
  {
    "code": "5010",
    "name": "Najeti krediti pri mednarodnih finančnih institucijah"
  },
  {
    "code": "501000",
    "name": "Najeti krediti pri mednarodnih finančnih institucijah - kratkoročni krediti"
  },
  {
    "code": "501001",
    "name": "Najeti krediti pri mednarodnih finančnih institucijah - dolgoročni krediti"
  },
  {
    "code": "5011",
    "name": "Najeti krediti pri tujih vladah"
  },
  {
    "code": "501100",
    "name": "Najeti krediti pri tujih vladah - kratkoročni krediti"
  },
  {
    "code": "501101",
    "name": "Najeti krediti pri tujih vladah - dolgoročni krediti"
  },
  {
    "code": "5012",
    "name": "Najeti krediti pri tujih bankah in finančnih institucijah"
  },
  {
    "code": "501200",
    "name": "Najeti krediti pri tujih bankah in finančnih institucijah - kratkoročni krediti"
  },
  {
    "code": "501201",
    "name": "Najeti krediti pri tujih bankah in finančnih institucijah - dolgoročni krediti"
  },
  {
    "code": "5013",
    "name": "Najeti krediti pri drugih tujih kreditodajalcih"
  },
  {
    "code": "501300",
    "name": "Najeti krediti pri drugih tujih kreditodajalcih - kratkoročni krediti"
  },
  {
    "code": "501301",
    "name": "Najeti krediti pri drugih tujih kreditodajalcih - dolgoročni krediti"
  },
  {
    "code": "5014",
    "name": "Sredstva, pridobljena z izdajo vrednostnih papirjev"
  },
  {
    "code": "501400",
    "name": "Kratkoročni vrednostni papirji, izdani na tujih trgih"
  },
  {
    "code": "501401",
    "name": "Dolgoročni vrednostni papirji, izdani na tujih trgih"
  },
  {
    "code": "55",
    "name": "ODPLAČILA DOLGA"
  },
  {
    "code": "550",
    "name": "ODPLAČILA DOMAČEGA DOLGA"
  },
  {
    "code": "5500",
    "name": "Odplačila kreditov Banki Slovenije"
  },
  {
    "code": "550000",
    "name": "Odplačila kreditov Banki Slovenije - kratkoročni krediti"
  },
  {
    "code": "5501",
    "name": "Odplačila kreditov bankam"
  },
  {
    "code": "550100",
    "name": "Odplačila kreditov bankam - kratkoročni krediti"
  },
  {
    "code": "550101",
    "name": "Odplačila kreditov bankam - dolgoročni krediti"
  },
  {
    "code": "5502",
    "name": "Odplačila kreditov drugim finančnim institucijam"
  },
  {
    "code": "550200",
    "name": "Odplačila kreditov drugim finančnim institucijam - kratkoročni krediti"
  },
  {
    "code": "550201",
    "name": "Odplačila kreditov drugim finančnim institucijam - dolgoročni krediti"
  },
  {
    "code": "5503",
    "name": "Odplačila kreditov drugim domačim kreditodajalcem"
  },
  {
    "code": "550300",
    "name": "Odplačila kreditov občinam - kratkoročni krediti"
  },
  {
    "code": "550301",
    "name": "Odplačila kreditov občinam - dolgoročni krediti"
  },
  {
    "code": "550304",
    "name": "Odplačila kreditov javnim skladom - kratkoročni krediti"
  },
  {
    "code": "550305",
    "name": "Odplačila kreditov javnim skladom - dolgoročni krediti"
  },
  {
    "code": "550306",
    "name": "Odplačila kreditov državnemu proračunu - kratkoročni krediti"
  },
  {
    "code": "550307",
    "name": "Odplačila kreditov državnemu proračunu - dolgoročni krediti"
  },
  {
    "code": "550308",
    "name": "Odplačila kreditov drugim domačim kreditodajalcem - kratkoročni krediti"
  },
  {
    "code": "550309",
    "name": "Odplačila kreditov drugim domačim kreditodajalcem - dolgoročni krediti"
  },
  {
    "code": "5504",
    "name": "Odplačila glavnice vrednostnih papirjev, izdanih na domačem trgu Odplačila glavnice kratkoročnih vrednostnih papirjev, izdanih na domačem trgu - enomesečne"
  },
  {
    "code": "550401",
    "name": "zakladne menice Odplačila glavnice kratkoročnih vrednostnih papirjev, izdanih na domačem trgu - trimesečne"
  },
  {
    "code": "550402",
    "name": "zakladne menice Odplačila glavnice kratkoročnih vrednostnih papirjev, izdanih na domačem trgu - šestmesečne"
  },
  {
    "code": "550403",
    "name": "zakladne menice Odplačila glavnice kratkoročnih vrednostnih papirjev, izdanih na domačem trgu -"
  },
  {
    "code": "550404",
    "name": "dvanajstmesečne zakladne menice"
  },
  {
    "code": "550409",
    "name": "Odplačila glavnice drugih kratkoročnih vrednostnih papirjev, izdanih na domačem trgu"
  },
  {
    "code": "550410",
    "name": "Odplačila glavnice drugih dolgoročnih vrednostnih papirjev, izdanih na domačem trgu Odplačilo glavnice kratkoročnih vrednostnih papirjev, izdanih na domačem trgu - devetmesečne"
  },
  {
    "code": "550411",
    "name": "zakladne menice"
  },
  {
    "code": "551",
    "name": "ODPLAČILA DOLGA V TUJINO"
  },
  {
    "code": "5510",
    "name": "Odplačila dolga mednarodnim finančnim institucijam"
  },
  {
    "code": "551000",
    "name": "Odplačila dolga mednarodnim finančnim institucijam - kratkoročni krediti"
  },
  {
    "code": "551001",
    "name": "Odplačila dolga mednarodnim finančnim institucijam - dolgoročni krediti"
  },
  {
    "code": "5511",
    "name": "Odplačila dolga tujim vladam"
  },
  {
    "code": "551100",
    "name": "Odplačila dolga tujim vladam - kratkoročni krediti"
  },
  {
    "code": "551101",
    "name": "Odplačila dolga tujim vladam - dolgoročni krediti"
  },
  {
    "code": "5512",
    "name": "Odplačila dolga tujim bankam in finančnim institucijam"
  },
  {
    "code": "551200",
    "name": "Odplačila dolga tujim bankam in finančnim institucijam - kratkoročni krediti"
  },
  {
    "code": "551201",
    "name": "Odplačila dolga tujim bankam in finančnim institucijam - dolgoročni krediti"
  },
  {
    "code": "5513",
    "name": "Odplačila dolga drugim tujim kreditodajalcem"
  },
  {
    "code": "551300",
    "name": "Odplačila dolga drugim tujim kreditodajalcem - kratkoročni krediti"
  },
  {
    "code": "551301",
    "name": "Odplačila dolga drugim tujim kreditodajalcem - dolgoročni krediti"
  },
  {
    "code": "5514",
    "name": "Odplačila glavnice vrednostnih papirjev, izdanih na tujih trgih"
  },
  {
    "code": "551400",
    "name": "Odplačila glavnice kratkoročnih vrednostnih papirjev, izdanih na tujih trgih"
  },
  {
    "code": "551401",
    "name": "Odplačila glavnice dolgoročnih vrednostnih papirjev, izdanih na tujih trgih"
  },
  {
    "code": "59",
    "name": "UGOTOVLJENA RAZLIKA"
  },
  {
    "code": "590",
    "name": "UGOTOVLJENA RAZLIKA"
  },
  {
    "code": "599",
    "name": "EVIDENČNI PROMET ZADOLŽEVANJA IN ODPLAČIL DOLGA"
  },
  {
    "code": "70",
    "name": "DAVČNI PRIHODKI"
  },
  {
    "code": "700",
    "name": "DAVKI NA DOHODEK IN DOBIČEK"
  },
  {
    "code": "7000",
    "name": "Dohodnina"
  },
  {
    "code": "700001",
    "name": "Dohodnina - letni poračun"
  },
  {
    "code": "700002",
    "name": "Akontacija dohodnine od dohodka iz zaposlitve Akontacija dohodnine od pokojnin, nadomestil in drugih dohodkov iz naslova obveznega in"
  },
  {
    "code": "700003",
    "name": "prostovoljnega pokojninskega in invalidskega zavarovanja"
  },
  {
    "code": "700004",
    "name": "Akontacija dohodnine od dohodkov iz drugega pogodbenega razmerja"
  },
  {
    "code": "700005",
    "name": "Akontacija dohodnine od drugih dohodkov"
  },
  {
    "code": "700008",
    "name": "Akontacija dohodnine od dohodka iz dejavnosti"
  },
  {
    "code": "700009",
    "name": "Dohodnina od dohodka iz dejavnosti na podlagi normiranih stroškov"
  },
  {
    "code": "700010",
    "name": "Dohodnina od dobička iz kapitala pri odsvojitvi nepremičnin Dohodnina od dobička iz kapitala pri odsvojitvi vrednostnih papirjev in drugih deležev ter"
  },
  {
    "code": "700011",
    "name": "investicijskih kuponov"
  },
  {
    "code": "700012",
    "name": "Dohodnina od dividend"
  },
  {
    "code": "700013",
    "name": "Dohodnina od obresti"
  },
  {
    "code": "700014",
    "name": "Dohodnina od dohodkov iz oddajanja premoženja v najem"
  },
  {
    "code": "700015",
    "name": "Akontacija dohodnine od dohodkov iz prenosa premoženjske pravice"
  },
  {
    "code": "700017",
    "name": "Zamudne obresti od dohodnine Akontacija dohodnine od drugih dohodkov iz osnovne kmetijske dejavnosti in osnovne gozdarske"
  },
  {
    "code": "700018",
    "name": "dejavnosti"
  },
  {
    "code": "700020",
    "name": "Dohodnina - občinski vir"
  },
  {
    "code": "700021",
    "name": "Dohodnina od nenapovedanih dohodkov"
  },
  {
    "code": "700022",
    "name": "Dohodnina - glavno mesto"
  },
  {
    "code": "700023",
    "name": "Akontacija dohodnine od katastrskega dohodka in pavšalne ocene dohodka na panj"
  },
  {
    "code": "7001",
    "name": "Davek od dohodkov pravnih oseb"
  },
  {
    "code": "700100",
    "name": "Davek od dohodkov pravnih in fizičnih oseb - davčni odtegljaj"
  },
  {
    "code": "700101",
    "name": "Zamudne obresti od davka od dohodkov pravnih oseb"
  },
  {
    "code": "7002",
    "name": "Drugi davki na dohodek in dobiček Dodatni davek od dohodkov članov poslovodstev in nadzornih organov v času finančne in"
  },
  {
    "code": "700200",
    "name": "gospodarske krize Zamudne obresti od dodatnega davka od dohodkov članov poslovodstev in nadzornih organov v"
  },
  {
    "code": "700201",
    "name": "času finančne in gospodarske krize"
  },
  {
    "code": "700202",
    "name": "Davek od dohodka iz finančnih instrumentov, ki ga oseba prejme za tuj račun Zamudne obresti od davka od dohodka iz finančnih instrumentov, ki ga oseba prejme za tuj"
  },
  {
    "code": "700203",
    "name": "račun"
  },
  {
    "code": "700204",
    "name": "Davek na dobiček zaradi spremembe namembnosti zemljišč"
  },
  {
    "code": "700205",
    "name": "Zamudne obresti od davka na dobiček zaradi spremembe namembnosti zemljišč"
  },
  {
    "code": "700299",
    "name": "Drugi davki na dohodek in dobiček"
  },
  {
    "code": "701",
    "name": "PRISPEVKI ZA SOCIALNO VARNOST"
  },
  {
    "code": "7010",
    "name": "Prispevki zaposlenih"
  },
  {
    "code": "701000",
    "name": "Prispevek za zaposlovanje od zaposlenih pri pravnih osebah"
  },
  {
    "code": "701001",
    "name": "Prispevek za zaposlovanje od zaposlenih pri fizičnih osebah, ki opravljajo dejavnost"
  },
  {
    "code": "701002",
    "name": "Prispevek za starševsko varstvo od zaposlenih pri pravnih osebah"
  },
  {
    "code": "701003",
    "name": "Prispevek za starševsko varstvo od zaposlenih pri fizičnih osebah, ki opravljajo dejavnost"
  },
  {
    "code": "701004",
    "name": "Prispevek za pokojninsko in invalidsko zavarovanje od zaposlenih pri pravnih osebah Prispevek za pokojninsko in invalidsko zavarovanje od zaposlenih pri fizičnih osebah, ki"
  },
  {
    "code": "701005",
    "name": "opravljajo dejavnost"
  },
  {
    "code": "701006",
    "name": "Prispevek za zdravstveno zavarovanje od zaposlenih pri pravnih osebah"
  },
  {
    "code": "701007",
    "name": "Prispevek za zdravstveno zavarovanje od zaposlenih pri fizičnih osebah, ki opravljajo dejavnost"
  },
  {
    "code": "701008",
    "name": "Prispevek za zdravstveno zavarovanje od zaposlenih pri tujem delodajalcu"
  },
  {
    "code": "701009",
    "name": "Prispevek za pokojninsko in invalidsko zavarovanje iz drugih pravnih razmerij"
  },
  {
    "code": "701010",
    "name": "Prispevek za zdravstveno zavarovanje iz drugih pravnih razmerij Prispevek za pokojninsko in invalidsko zavarovanje od začasnih in občasnih del študentov in"
  },
  {
    "code": "701011",
    "name": "dijakov"
  },
  {
    "code": "701012",
    "name": "Prispevek zaposlenih za dolgotrajno oskrbo"
  },
  {
    "code": "7011",
    "name": "Prispevki delodajalcev"
  },
  {
    "code": "701100",
    "name": "Prispevek za zaposlovanje za zaposlene pri pravnih osebah"
  },
  {
    "code": "701101",
    "name": "Prispevek za zaposlovanje za zaposlene pri fizičnih osebah, ki opravljajo dejavnost"
  },
  {
    "code": "701102",
    "name": "Prispevek za starševsko varstvo za zaposlene pri pravnih osebah"
  },
  {
    "code": "701103",
    "name": "Prispevek za starševsko varstvo za zaposlene pri fizičnih osebah, ki opravljajo dejavnost"
  },
  {
    "code": "701104",
    "name": "Prispevek za pokojninsko in invalidsko zavarovanje za zaposlene pri pravnih osebah Prispevek za pokojninsko in invalidsko zavarovanje za zaposlene pri fizičnih osebah, ki opravljajo"
  },
  {
    "code": "701105",
    "name": "dejavnost"
  },
  {
    "code": "701106",
    "name": "Prispevek za pokojninsko in invalidsko zavarovanje za člane kmetije Prispevek za pokojninsko in invalidsko zavarovanje za zavarovalno dobo s povečanjem za"
  },
  {
    "code": "701108",
    "name": "zaposlene pri pravnih osebah"
  },
  {
    "code": "701109",
    "name": "Prispevek za zdravstveno zavarovanje za zaposlene pri pravnih osebah"
  },
  {
    "code": "701110",
    "name": "Prispevek za poškodbe pri delu in poklicne bolezni za zavarovance"
  },
  {
    "code": "701111",
    "name": "Prispevek za pokojninsko in invalidsko zavarovanje za posebne primere zavarovanja"
  },
  {
    "code": "701112",
    "name": "Prispevek za pokojninsko in invalidsko zavarovanje iz drugih pravnih razmerij"
  },
  {
    "code": "701113",
    "name": "Prispevek za zdravstveno zavarovanje za zaposlene pri fizičnih osebah, ki opravljajo dejavnost"
  },
  {
    "code": "701114",
    "name": "Prispevek za pokojninsko in invalidsko zavarovanje oseb zaposlenih pri tujem delodajalcu Prispevek za pokojninsko in invalidsko zavarovanje za začasna in občasna dela študentov in"
  },
  {
    "code": "701115",
    "name": "dijakov"
  },
  {
    "code": "701116",
    "name": "Prispevek za zdravstveno zavarovanje za začasna in občasna dela študentov in dijakov"
  },
  {
    "code": "701117",
    "name": "Prispevek delodajalcev za dolgotrajno oskrbo"
  },
  {
    "code": "7012",
    "name": "Prispevki samozaposlenih"
  },
  {
    "code": "701200",
    "name": "Prispevek za zaposlovanje od fizičnih oseb, ki opravljajo dejavnost - od zavarovalne osnove"
  },
  {
    "code": "701201",
    "name": "Prispevek za zaposlovanje od fizičnih oseb, ki opravljajo dejavnost - iz zavarovalne osnove"
  },
  {
    "code": "701202",
    "name": "Prispevek za starševsko varstvo od fizičnih oseb, ki opravljajo dejavnost Prispevek za pokojninsko in invalidsko zavarovanje od fizičnih oseb, ki opravljajo dejavnost - od"
  },
  {
    "code": "701203",
    "name": "zavarovalne osnove Prispevek za pokojninsko in invalidsko zavarovanje od fizičnih oseb, ki opravljajo dejavnost - iz"
  },
  {
    "code": "701204",
    "name": "zavarovalne osnove"
  },
  {
    "code": "701205",
    "name": "Prispevek za pokojninsko in invalidsko zavarovanje kmetov - lastnikov kmetijskih zemljišč Posebni prispevek za pokojninsko in invalidsko zavarovanje za zavarovalno dobo s povečanjem"
  },
  {
    "code": "701206",
    "name": "od oseb, ki opravljajo dejavnost in pri njih zaposlenih osebah Prispevek za zdravstveno zavarovanje kmetov in članov njihovih gospodinjstev in drugih oseb, ki"
  },
  {
    "code": "701207",
    "name": "plačujejo prispevek od katastrskega dohodka Prispevek za zdravstveno zavarovanje kmetov, ki plačujejo prispevek od osnove za pokojninsko"
  },
  {
    "code": "701208",
    "name": "in invalidsko zavarovanje"
  },
  {
    "code": "701211",
    "name": "Prispevek za poškodbe pri delu in poklicna obolenja kmetov Prispevek za zdravstveno zavarovanje oseb, ki samostojno opravljajo gospodarsko ali poklicno"
  },
  {
    "code": "701213",
    "name": "dejavnost od zavarovalne osnove Prispevek za zdravstveno zavarovanje oseb, ki samostojno opravljajo gospodarsko ali poklicno"
  },
  {
    "code": "701214",
    "name": "dejavnost iz zavarovalne osnove"
  },
  {
    "code": "701215",
    "name": "Prispevek sampozaposlenih za dolgotrajno oskrbo"
  },
  {
    "code": "7013",
    "name": "Ostali prispevki za socialno varnost"
  },
  {
    "code": "701300",
    "name": "Zamudne obresti iz naslova prispevkov za zaposlovanje"
  },
  {
    "code": "701301",
    "name": "Zamudne obresti iz naslova prispevkov za starševsko varstvo"
  },
  {
    "code": "701302",
    "name": "Zamudne obresti iz naslova prispevkov za pokojninsko in invalidsko zavarovanje"
  },
  {
    "code": "701306",
    "name": "Pozneje vplačani prispevki za ZPIZ iz preteklih let"
  },
  {
    "code": "701307",
    "name": "Prispevek delojemalca za zaposlovanje od starševskih nadomestil"
  },
  {
    "code": "701308",
    "name": "Prispevek delojemalca za starševsko varstvo od starševskih nadomestil"
  },
  {
    "code": "701309",
    "name": "Prispevek delojemalca za pokojninsko in invalidsko zavarovanje od starševskih nadomestil"
  },
  {
    "code": "701310",
    "name": "Prispevek delojemalca za zdravstveno zavarovanje od starševskih nadomestil Prispevek delojemalca za zaposlovanje od nadomestil zaradi bolezenske odsotnosti, ki jih ZZZS"
  },
  {
    "code": "701311",
    "name": "neposredno izplačuje upravičencem"
  },
  {
    "code": "701312",
    "name": "ZZZS neposredno izplačuje upravičencem Prispevek delojemalca za pokojninsko in invalidsko zavarovanje od nadomestil zaradi"
  },
  {
    "code": "701313",
    "name": "bolezenske odsotnosti, ki jih ZZZS neposredno izplačuje upravičencem Prispevek delojemalca za zdravstveno zavarovanje od nadomestil zaradi bolezenske odsotnosti,"
  },
  {
    "code": "701314",
    "name": "ki jih ZZZS neposredno izplačuje upravičencem"
  },
  {
    "code": "701315",
    "name": "Prispevek delojemalca za zaposlovanje od nadomestil za čas brezposelnosti"
  },
  {
    "code": "701316",
    "name": "Prispevek delojemalca za starševsko varstvo od nadomestil za čas brezposelnosti Prispevek delojemalca za pokojninsko in invalidsko zavarovanje od nadomestil za čas"
  },
  {
    "code": "701317",
    "name": "brezposelnosti"
  },
  {
    "code": "701318",
    "name": "Prispevek delojemalca za zdravstveno zavarovanje od nadomestil za čas brezposelnosti Prispevek delojemalca za zaposlovanje od nadomestil iz invalidskega zavarovanja, ki jih ZPIZ"
  },
  {
    "code": "701319",
    "name": "neposredno izplačuje upravičencem Prispevek delojemalca za zdravstveno zavarovanje od nadomestil iz invalidskega zavarovanja, ki"
  },
  {
    "code": "701320",
    "name": "jih ZPIZ neposredno izplačuje upravičencem Prispevek delojemalca za starševsko varstvo od nadomestil iz invalidskega zavarovanja, ki jih"
  },
  {
    "code": "701321",
    "name": "ZPIZ neposredno izplačuje upravičencem"
  },
  {
    "code": "701322",
    "name": "Prispevek delojemalca za zdravstveno zavarovanje vojaških obveznikov, ki služijo vojaški rok Prispevek za zdravstveno zavarovanje za poškodbe pri delu in poklicne bolezni iz drugih pravnih"
  },
  {
    "code": "701323",
    "name": "razmerij"
  },
  {
    "code": "701324",
    "name": "Prispevek za zdravstveno zavarovanje oseb, ki plačujejo prispevek v pavšalu"
  },
  {
    "code": "701325",
    "name": "Prispevek za zdravstveno zavarovanje oseb, ki niso zavarovane iz drugih naslovov"
  },
  {
    "code": "701326",
    "name": "Prispevek za zdravstveno zavarovanje od drugih oseb Prispevek za pokojninsko in invalidsko zavarovanje za prostovoljno vključitev v obvezno"
  },
  {
    "code": "701327",
    "name": "zavarovanje"
  },
  {
    "code": "701328",
    "name": "Prispevek za pokojninsko in invalidsko zavarovanje iz osebnega dopolnilnega dela"
  },
  {
    "code": "701329",
    "name": "Obvezni zdravstveni prispevek"
  },
  {
    "code": "701330",
    "name": "Prispevki za dolgotrajno oskrbo za določene osebe"
  },
  {
    "code": "701331",
    "name": "Prispevek upokojencev za dolgotrajno oskrbo"
  },
  {
    "code": "701332",
    "name": "Zamudne obresti iz naslova prispevkov za dolgotrajno oskrbo"
  },
  {
    "code": "702",
    "name": "DAVKI NA PLAČILNO LISTO IN DELOVNO SILO"
  },
  {
    "code": "7021",
    "name": "Posebni davek na določene prejemke"
  },
  {
    "code": "702100",
    "name": "Posebni davek na določene prejemke (na pogodbeno delo)"
  },
  {
    "code": "702101",
    "name": "Zamudne obresti od posebnega davka na določene prejemke"
  },
  {
    "code": "703",
    "name": "DAVKI NA PREMOŽENJE"
  },
  {
    "code": "7030",
    "name": "Davki na nepremičnine"
  },
  {
    "code": "703000",
    "name": "Davek od premoženja od stavb od fizičnih oseb"
  },
  {
    "code": "703001",
    "name": "Davek od premoženja od prostorov za počitek in rekreacijo"
  },
  {
    "code": "703002",
    "name": "Zamudne obresti od davkov na nepremičnine"
  },
  {
    "code": "703003",
    "name": "Nadomestilo za uporabo stavbnega zemljišča od pravnih oseb"
  },
  {
    "code": "703004",
    "name": "Nadomestilo za uporabo stavbnega zemljišča od fizičnih oseb"
  },
  {
    "code": "703005",
    "name": "Zamudne obresti iz naslova nadomestila za uporabo stavbnega zemljišča"
  },
  {
    "code": "703009",
    "name": "Drugi davki od premoženja od nepremičnin"
  },
  {
    "code": "703010",
    "name": "Davek na nepremično premoženje večje vrednosti"
  },
  {
    "code": "703011",
    "name": "Zamudne obresti od davka na nepremično premoženje večje vrednosti"
  },
  {
    "code": "703012",
    "name": "Davek na nepremičnine"
  },
  {
    "code": "703013",
    "name": "Zamudne obresti od davka na nepremičnine"
  },
  {
    "code": "7031",
    "name": "Davki na premičnine"
  },
  {
    "code": "703100",
    "name": "Davek na vodna plovila"
  },
  {
    "code": "703101",
    "name": "Zamudne obresti od davkov na premičnine"
  },
  {
    "code": "703103",
    "name": "Drugi davki od premoženja od premičnin"
  },
  {
    "code": "703104",
    "name": "Dodatni davek od vodnih plovil"
  },
  {
    "code": "703105",
    "name": "Zamudne obresti od dodatnega davka od vodnih plovil"
  },
  {
    "code": "7032",
    "name": "Davki na dediščine in darila"
  },
  {
    "code": "703200",
    "name": "Davek na dediščine in darila"
  },
  {
    "code": "703202",
    "name": "Zamudne obresti od davka na dediščine in darila"
  },
  {
    "code": "7033",
    "name": "Davki na promet nepremičnin in na finančno premoženje"
  },
  {
    "code": "703300",
    "name": "Davek na promet nepremičnin od pravnih oseb"
  },
  {
    "code": "703301",
    "name": "Davek na promet nepremičnin od fizičnih oseb"
  },
  {
    "code": "703303",
    "name": "Zamudne obresti od davka na promet nepremičnin"
  },
  {
    "code": "703306",
    "name": "Davek od dobička od odsvojitve izvedenih finančnih instrumentov"
  },
  {
    "code": "703307",
    "name": "Zamudne obresti od davka od dobička od odsvojitve izvedenih finančnih instrumentov"
  },
  {
    "code": "703308",
    "name": "Davek na bilančno vsoto bank"
  },
  {
    "code": "704",
    "name": "DOMAČI DAVKI NA BLAGO IN STORITVE"
  },
  {
    "code": "7040",
    "name": "Davek na dodano vrednost"
  },
  {
    "code": "704000",
    "name": "Davek na dodano vrednost po obračunu"
  },
  {
    "code": "704001",
    "name": "Davek na dodano vrednost od uvoženega blaga"
  },
  {
    "code": "704002",
    "name": "Zamudne obresti od davka na dodano vrednost po obračunu"
  },
  {
    "code": "704003",
    "name": "Zamudne obresti od davka na dodano vrednost od uvoženega blaga"
  },
  {
    "code": "7041",
    "name": "Drugi davki na blago in storitve"
  },
  {
    "code": "704104",
    "name": "Okoljska dajatev za onesnaževanje zraka z emisijo CO2 od tekočih goriv"
  },
  {
    "code": "704105",
    "name": "Okoljska dajatev za onesnaževanje zraka z emisijo CO2 od plinastih goriv"
  },
  {
    "code": "704106",
    "name": "Okoljska dajatev za onesnaževanje zraka z emisijo CO2 od trdih goriv"
  },
  {
    "code": "704107",
    "name": "Zamudne obresti od okoljskih dajatev za onesnaževanje zraka z emisijo CO2"
  },
  {
    "code": "7042",
    "name": "Trošarine"
  },
  {
    "code": "704200",
    "name": "Trošarina od energentov in električne energije"
  },
  {
    "code": "704201",
    "name": "Trošarina od alkohola in alkoholnih pijač"
  },
  {
    "code": "704202",
    "name": "Trošarina od tobačnih izdelkov"
  },
  {
    "code": "704203",
    "name": "Zamudne obresti od trošarin"
  },
  {
    "code": "7043",
    "name": "Dobički fiskalnih monopolov"
  },
  {
    "code": "704399",
    "name": "Dobički fiskalnih monopolov"
  },
  {
    "code": "7044",
    "name": "Davki na posebne storitve"
  },
  {
    "code": "704400",
    "name": "Posebni prometni davek od posebnih iger na srečo"
  },
  {
    "code": "704402",
    "name": "Zamudne obresti od posebnega prometnega davka od posebnih iger na srečo"
  },
  {
    "code": "704403",
    "name": "Davek na dobitke od iger na srečo"
  },
  {
    "code": "704405",
    "name": "Zamudne obresti od davka na dobitke od iger na srečo"
  },
  {
    "code": "704406",
    "name": "Davek od klasičnih iger na srečo"
  },
  {
    "code": "704407",
    "name": "Zamudne obresti od davka od klasičnih iger na srečo"
  },
  {
    "code": "704408",
    "name": "Davek od posebnih iger na srečo"
  },
  {
    "code": "704409",
    "name": "Zamudne obresti od davka od posebnih iger na srečo"
  },
  {
    "code": "704410",
    "name": "Davek od prometa zavarovalnih poslov"
  },
  {
    "code": "704411",
    "name": "Zamudne obresti od davka od prometa zavarovalnih poslov"
  },
  {
    "code": "704412",
    "name": "Davek na finančne storitve"
  },
  {
    "code": "704413",
    "name": "Zamudne obresti od davka na finančne storitve"
  },
  {
    "code": "704414",
    "name": "Davek na srečke"
  },
  {
    "code": "7045",
    "name": "Dovoljenja za poslovanje in za opravljanje dejavnosti"
  },
  {
    "code": "704599",
    "name": "Dovoljenja za poslovanje in za opravljanje dejavnosti"
  },
  {
    "code": "7046",
    "name": "Letna dajatev za uporabo vozil v cestnem prometu"
  },
  {
    "code": "704603",
    "name": "Pristojbina od registracijskih tablic po posebnem naročilu"
  },
  {
    "code": "704604",
    "name": "Letna dajatev za uporabo vozil v cestnem prometu od pravnih oseb"
  },
  {
    "code": "704605",
    "name": "Letna dajatev za uporabo vozil v cestnem prometu od fizičnih oseb in zasebnikov"
  },
  {
    "code": "704606",
    "name": "Dajatev za odjavljena vozila"
  },
  {
    "code": "7047",
    "name": "Drugi davki na uporabo blaga in storitev"
  },
  {
    "code": "704700",
    "name": "Okoljska dajatev za onesnaževanje okolja zaradi odvajanja odpadnih voda"
  },
  {
    "code": "704701",
    "name": "Zamudne obresti od okoljske dajatve za onesnaževanje okolja zaradi odvajanja odpadnih voda"
  },
  {
    "code": "704702",
    "name": "Vodna povračila"
  },
  {
    "code": "704703",
    "name": "Zamudne obresti od vodnih povračil"
  },
  {
    "code": "704704",
    "name": "Turistična taksa"
  },
  {
    "code": "704706",
    "name": "Občinske takse od pravnih oseb"
  },
  {
    "code": "704707",
    "name": "Občinske takse od fizičnih oseb in zasebnikov"
  },
  {
    "code": "704708",
    "name": "Pristojbina za vzdrževanje gozdnih cest"
  },
  {
    "code": "704710",
    "name": "Odškodnine za spremembo namembnosti kmetijskega zemljišča in gozda Zamudne obresti iz naslova odškodnine za spremembo namembnosti kmetijskega zemljišča in"
  },
  {
    "code": "704711",
    "name": "gozda"
  },
  {
    "code": "704713",
    "name": "Požarna taksa"
  },
  {
    "code": "704714",
    "name": "Odškodnine od izkopanih rudnin"
  },
  {
    "code": "704715",
    "name": "Priključne takse"
  },
  {
    "code": "704716",
    "name": "Ekološke takse"
  },
  {
    "code": "704717",
    "name": "Okoljska dajatev za onesnaževanje okolja zaradi uporabe mazalnih olj in tekočin"
  },
  {
    "code": "704718",
    "name": "Sredstva za vzdrževanje melioracijskih sistemov"
  },
  {
    "code": "704719",
    "name": "Okoljska dajatev za onesnaževanje okolja zaradi odlaganja odpadkov"
  },
  {
    "code": "704720",
    "name": "Okoljska dajatev za onesnaževanje okolja zaradi nastajanja izrabljenih motornih vozil Zamudne obresti od okoljske dajatve za onesnaževanje okolja zaradi uporabe mazalnih olj in"
  },
  {
    "code": "704721",
    "name": "tekočin Zamudne obresti od okoljske dajatve za onesnaževanje okolja zaradi nastajanja izrabljenih"
  },
  {
    "code": "704722",
    "name": "motornih vozil Okoljska dajatev za onesnaževanje okolja zaradi nastajanja odpadne električne in elektronske"
  },
  {
    "code": "704723",
    "name": "opreme Zamudne obresti od okoljske dajatve za onesnaževanje okolja zaradi nastajanja odpadne"
  },
  {
    "code": "704724",
    "name": "električne in elektronske opreme"
  },
  {
    "code": "704725",
    "name": "Okoljska dajatev za onesnaževanje okolja zaradi nastajanja izrabljenih gum"
  },
  {
    "code": "704726",
    "name": "Zamudne obresti od okoljske dajatve za onesnaževanje okolja zaradi nastajanja izrabljenih gum"
  },
  {
    "code": "704727",
    "name": "Okoljska dajatev za onesnaževanje okolja zaradi nastajanja odpadne embalaže Zamudne obresti od okoljske dajatve za onesnaževanje okolja zaradi nastajanja odpadne"
  },
  {
    "code": "704728",
    "name": "embalaže"
  },
  {
    "code": "704729",
    "name": "Okoljska dajatev za onesnaževanje okolja zaradi uporabe hlapnih organskih spojin Zamudne obresti od okoljske dajatve za onesnaževanje okolja zaradi uporabe hlapnih organskih"
  },
  {
    "code": "704730",
    "name": "spojin"
  },
  {
    "code": "704731",
    "name": "Zamudne obresti od požarnih taks"
  },
  {
    "code": "704732",
    "name": "Plačilo prispevka za pridelavo gensko spremenjenih rastlin"
  },
  {
    "code": "704733",
    "name": "Zamudne obresti od okoljske dajatve za onesnaževanje okolja zaradi odlaganja odpadkov"
  },
  {
    "code": "704734",
    "name": "Pribitek k cestnini"
  },
  {
    "code": "704735",
    "name": "Zamudne obresti iz naslova pribitka k cestnini"
  },
  {
    "code": "704736",
    "name": "Taksa na pretovor v koprskem tovornem pristanišču"
  },
  {
    "code": "704737",
    "name": "Zamudne obresti od takse na pretovor v koprskem tovornem pristanišču"
  },
  {
    "code": "7048",
    "name": "Davki od prometa motornih vozil"
  },
  {
    "code": "704800",
    "name": "Davek od prometa novih motornih vozil"
  },
  {
    "code": "704801",
    "name": "Zamudne obresti od davka od prometa novih motornih vozil"
  },
  {
    "code": "704802",
    "name": "Davek od prometa rabljenih motornih vozil"
  },
  {
    "code": "704803",
    "name": "Zamudne obresti od davka od prometa rabljenih motornih vozil"
  },
  {
    "code": "704804",
    "name": "Dodatni davek na motorna vozila"
  },
  {
    "code": "705",
    "name": "DAVKI NA MEDNARODNO TRGOVINO IN TRANSAKCIJE"
  },
  {
    "code": "7050",
    "name": "Carine"
  },
  {
    "code": "705002",
    "name": "Zamudne obresti od uvoznih dajatev z učinkom carin"
  },
  {
    "code": "705003",
    "name": "Uvozne dajatve z učinkom carin"
  },
  {
    "code": "705004",
    "name": "Izravnalne in protidampinške dajatve"
  },
  {
    "code": "7051",
    "name": "Druge uvozne dajatve"
  },
  {
    "code": "7052",
    "name": "Izvozne dajatve"
  },
  {
    "code": "7053",
    "name": "Dobički izvoznih in uvoznih monopolov"
  },
  {
    "code": "7054",
    "name": "Dobički od menjave tujih valut"
  },
  {
    "code": "705499",
    "name": "Dobički od menjave tujih valut"
  },
  {
    "code": "7055",
    "name": "Davki na menjavo tujih valut"
  },
  {
    "code": "705599",
    "name": "Davki na menjavo tujih valut"
  },
  {
    "code": "7056",
    "name": "Drugi davki na mednarodno trgovino in transakcije"
  },
  {
    "code": "705699",
    "name": "Drugi davki na mednarodno trgovino in transakcije"
  },
  {
    "code": "706",
    "name": "DRUGI DAVKI IN PRISPEVKI"
  },
  {
    "code": "7060",
    "name": "Drugi davki in prispevki Pozneje plačani odloženi davki in prispevki, ki jih ni možno razvrstiti v posamezno kategorijo"
  },
  {
    "code": "706000",
    "name": "davkov"
  },
  {
    "code": "706001",
    "name": "Pozneje vplačani ukinjeni davki in prispevki"
  },
  {
    "code": "706002",
    "name": "Prisilne izterjave davkov in prispevkov"
  },
  {
    "code": "706003",
    "name": "Zamudne obresti od pozneje vplačanih ukinjenih davkov in prispevkov"
  },
  {
    "code": "706099",
    "name": "Nerazporejeni davki in prispevki"
  },
  {
    "code": "71",
    "name": "NEDAVČNI PRIHODKI"
  },
  {
    "code": "710",
    "name": "UDELEŽBA NA DOBIČKU IN DOHODKI OD PREMOŽENJA"
  },
  {
    "code": "7100",
    "name": "Prihodki od udeležbe na dobičku in dividend ter presežkov prihodkov nad odhodki"
  },
  {
    "code": "710002",
    "name": "Prihodki iz naslova presežka prihodkov nad odhodki Banke Slovenije"
  },
  {
    "code": "710003",
    "name": "Prihodki iz naslova presežka prihodkov nad odhodki posrednih uporabnikov proračunov"
  },
  {
    "code": "710004",
    "name": "Prihodki od udeležbe na dobičku in dividend nefinančnih družb"
  },
  {
    "code": "710005",
    "name": "Prihodki od udeležbe na dobičku in dividend finančnih družb"
  },
  {
    "code": "7102",
    "name": "Prihodki od obresti"
  },
  {
    "code": "710200",
    "name": "Prihodki od obresti od sredstev na vpogled"
  },
  {
    "code": "710201",
    "name": "Prihodki od obresti od vezanih depozitov iz nenamenskih sredstev"
  },
  {
    "code": "710202",
    "name": "Prihodki od obresti od vezanih depozitov iz stalne rezerve - redna sredstva"
  },
  {
    "code": "710203",
    "name": "Prihodki od obresti od vezanih depozitov iz stalne rezerve - druga sredstva"
  },
  {
    "code": "710204",
    "name": "Prihodki od obresti od vezanih depozitov iz sredstev DARS"
  },
  {
    "code": "710205",
    "name": "Prihodki od obresti od vezanih depozitov iz ostalih namenskih sredstev"
  },
  {
    "code": "710206",
    "name": "Prihodki od obresti od deviznih depozitov iz nenamenskih sredstev"
  },
  {
    "code": "710207",
    "name": "Prihodki od obresti od deviznih depozitov iz ostalih namenskih sredstev"
  },
  {
    "code": "710208",
    "name": "Prihodki od obresti od danih posojil javnim podjetjem"
  },
  {
    "code": "710209",
    "name": "Prihodki od obresti od danih posojil finančnim institucijam"
  },
  {
    "code": "710210",
    "name": "Prihodki od obresti od danih posojil privatnim podjetjem in zasebnikom"
  },
  {
    "code": "710211",
    "name": "Prihodki od obresti od danih posojil občanom"
  },
  {
    "code": "710212",
    "name": "Prihodki od obresti od danih posojil drugim javnim skladom in javnim agencijam"
  },
  {
    "code": "710213",
    "name": "Prihodki od obresti od danih posojil drugim ravnem države"
  },
  {
    "code": "710214",
    "name": "Prihodki od obresti od danih posojil v tujino"
  },
  {
    "code": "710215",
    "name": "Drugi prihodki od obresti"
  },
  {
    "code": "710216",
    "name": "Prihodki od obresti od danih posojil državnemu proračunu"
  },
  {
    "code": "710218",
    "name": "Prihodki od obresti danih posojil s strani upravljavca EZR"
  },
  {
    "code": "7103",
    "name": "Prihodki od premoženja"
  },
  {
    "code": "710300",
    "name": "Prihodki iz naslova najemnin za kmetijska zemljišča in gozdove"
  },
  {
    "code": "710301",
    "name": "Prihodki od najemnin za poslovne prostore"
  },
  {
    "code": "710302",
    "name": "Prihodki od najemnin za stanovanja"
  },
  {
    "code": "710303",
    "name": "Prihodki od najemnin za opremo"
  },
  {
    "code": "710304",
    "name": "Prihodki od drugih najemnin"
  },
  {
    "code": "710305",
    "name": "Prihodki od zakupnin"
  },
  {
    "code": "710306",
    "name": "Prihodki iz naslova podeljenih koncesij"
  },
  {
    "code": "710307",
    "name": "Prihodki iz naslova podeljenih licenčnin"
  },
  {
    "code": "710309",
    "name": "Prihodki iz naslova koncesijskih dajatev od posebnih iger na srečo"
  },
  {
    "code": "710310",
    "name": "Zamudne obresti od koncesijskih dajatev od posebnih iger na srečo"
  },
  {
    "code": "710311",
    "name": "Prihodki od podeljenih koncesij za rudarsko pravico"
  },
  {
    "code": "710312",
    "name": "Prihodki od podeljenih koncesij za vodno pravico"
  },
  {
    "code": "710313",
    "name": "Prihodki od nadomestila za dodelitev služnostne pravice in ustanovitev stavbne pravice"
  },
  {
    "code": "710314",
    "name": "Prihodki od dodatne koncesijske dajatve za občasna in začasna dela študentov in dijakov"
  },
  {
    "code": "710315",
    "name": "Prihodki od koncesijske dajatve za občasna in začasna dela študentov in dijakov"
  },
  {
    "code": "710316",
    "name": "Prihodki od dajatve za začasno ali občasno delo upokojencev"
  },
  {
    "code": "710317",
    "name": "Prihodki iz naslova vodne pravice, podeljene z vodnim dovoljenjem"
  },
  {
    "code": "710318",
    "name": "Prihodki od nadomestil za upravljanje državnih gozdov"
  },
  {
    "code": "710399",
    "name": "Drugi prihodki od premoženja"
  },
  {
    "code": "711",
    "name": "TAKSE IN PRISTOJBINE"
  },
  {
    "code": "7110",
    "name": "Sodne takse"
  },
  {
    "code": "711000",
    "name": "Sodne takse od pravnih in fizičnih oseb ter zasebnikov"
  },
  {
    "code": "7111",
    "name": "Upravne takse in pristojbine"
  },
  {
    "code": "711100",
    "name": "Upravne takse za dokumente iz upravnih dejanj in drugo"
  },
  {
    "code": "711101",
    "name": "Upravne takse s področja notranjih in splošnih upravnih zadev"
  },
  {
    "code": "711103",
    "name": "Konzularne takse"
  },
  {
    "code": "711104",
    "name": "Pristojbina za varstvo industrijske lastnine"
  },
  {
    "code": "711105",
    "name": "Tarifa za varnost plovbe"
  },
  {
    "code": "711106",
    "name": "Pristojbina za pregled zrakoplova Državne upravne takse za preglede pošiljk vina in drugih proizvodov iz grozdja in vina v"
  },
  {
    "code": "711108",
    "name": "zunanjetrgovinskem prometu"
  },
  {
    "code": "711109",
    "name": "Pristojbina za veterinarsko spričevalo"
  },
  {
    "code": "711110",
    "name": "Pristojbina za veterinarsko potrdilo"
  },
  {
    "code": "711111",
    "name": "Pristojbina za veterinarski pregled"
  },
  {
    "code": "711113",
    "name": "Pristojbina za preverjanje strokovne usposobljenosti letalskega osebja"
  },
  {
    "code": "711114",
    "name": "Upravne takse s področja homologacije vozil"
  },
  {
    "code": "711115",
    "name": "Upravne takse za pridobitev in vzdrževanje akreditacije"
  },
  {
    "code": "711117",
    "name": "Pristojbina za uporabo radijskih frekvenc"
  },
  {
    "code": "711118",
    "name": "Pristojbina za varstvo novih sort rastlin in vzdrževanje žlahtniteljske pravice rastlin Upravne takse za preizkuse odobritve tipa meril in v postopku registracije znaka proizvajalca"
  },
  {
    "code": "711119",
    "name": "predmetov iz plemenitih kovin"
  },
  {
    "code": "711120",
    "name": "Upravne takse s področja prometa in zvez"
  },
  {
    "code": "711121",
    "name": "Gradbene upravne takse"
  },
  {
    "code": "711122",
    "name": "Upravne takse s področja prometa s kemikalijami"
  },
  {
    "code": "711123",
    "name": "Upravne takse na področju varstva konkurence"
  },
  {
    "code": "711124",
    "name": "Upravne takse na področju pravic intelektualne lastnine"
  },
  {
    "code": "711125",
    "name": "Upravna taksa na področju varstva pri delu"
  },
  {
    "code": "711126",
    "name": "Upravna taksa za ugotovitev zdravstvene neoporečnosti živil in predmetov splošne rabe"
  },
  {
    "code": "711129",
    "name": "Taksa za postopek revizije javnega naročanja"
  },
  {
    "code": "711130",
    "name": "Pristojbina za športni in rekreacijski ribolov na morju"
  },
  {
    "code": "711131",
    "name": "Pristojbina za izvajanje veterinarsko - higienske službe"
  },
  {
    "code": "711132",
    "name": "Pristojbina za veterinarski nadzor"
  },
  {
    "code": "711133",
    "name": "Pristojbina za veterinarski pregled pri trgovanju in izvozu"
  },
  {
    "code": "711134",
    "name": "Pristojbina za veterinarski pregled pri uvozu"
  },
  {
    "code": "711135",
    "name": "Pristojbina za monitoring"
  },
  {
    "code": "711136",
    "name": "Pristojbina na področju zdravstvenega varstva rastlin in registracije fitofarmacevtskih sredstev"
  },
  {
    "code": "711137",
    "name": "Zamudne obresti od upravnih taks"
  },
  {
    "code": "711138",
    "name": "Prispevek za promocijo kmetijskih in živilskih proizvodov"
  },
  {
    "code": "711199",
    "name": "Druge pristojbine"
  },
  {
    "code": "712",
    "name": "GLOBE IN DRUGE DENARNE KAZNI"
  },
  {
    "code": "7120",
    "name": "Globe in druge denarne kazni"
  },
  {
    "code": "712000",
    "name": "Denarne kazni za kazniva dejanja fizičnih in pravnih oseb"
  },
  {
    "code": "712001",
    "name": "Globe za prekrške"
  },
  {
    "code": "712003",
    "name": "Druge globe, denarne kazni in odvzem premoženjske koristi s plačilom denarnega zneska"
  },
  {
    "code": "712005",
    "name": "Denarne kazni v upravnih postopkih"
  },
  {
    "code": "712007",
    "name": "Nadomestilo za degradacijo in uzurpacijo prostora"
  },
  {
    "code": "712008",
    "name": "Povprečnine oz. sodne takse ter drugi stroški na podlagi zakona o prekrških"
  },
  {
    "code": "712009",
    "name": "Povprečnine oz. sodne takse kazenskega postopka"
  },
  {
    "code": "713",
    "name": "PRIHODKI OD PRODAJE BLAGA IN STORITEV"
  },
  {
    "code": "7130",
    "name": "Prihodki od prodaje blaga in storitev na trgu"
  },
  {
    "code": "713000",
    "name": "Prihodki od prodaje blaga in storitev na trgu"
  },
  {
    "code": "713001",
    "name": "Prihodki od prodaje materiala in odpadkov"
  },
  {
    "code": "713002",
    "name": "Prihodki obratov družbene prehrane"
  },
  {
    "code": "713003",
    "name": "Prihodki od počitniške dejavnosti"
  },
  {
    "code": "713004",
    "name": "Prihodki od prodanih vstopnic za kulturne, športne in druge prireditve"
  },
  {
    "code": "713005",
    "name": "Prihodki od vstopnin"
  },
  {
    "code": "713006",
    "name": "Prihodki od kotizacij za seminarje, posvetovanja, simpozije in druga strokovna srečanja"
  },
  {
    "code": "713008",
    "name": "Prihodki od prodaje pomorskih kart"
  },
  {
    "code": "713099",
    "name": "Drugi prihodki od prodaje blaga in storitev na trgu"
  },
  {
    "code": "714",
    "name": "DRUGI NEDAVČNI PRIHODKI"
  },
  {
    "code": "7140",
    "name": "Prostovoljni prispevki za socialno varnost"
  },
  {
    "code": "714010",
    "name": "Dokupi pokojninske dobe"
  },
  {
    "code": "714099",
    "name": "Drugi prostovoljni prispevki za socialno varnost"
  },
  {
    "code": "7141",
    "name": "Drugi nedavčni prihodki"
  },
  {
    "code": "714100",
    "name": "Drugi nedavčni prihodki"
  },
  {
    "code": "714103",
    "name": "Prihodki na podlagi EU zakonodaje in sporazumov o socialnem zavarovanju"
  },
  {
    "code": "714104",
    "name": "Prihodki iz naslova regresnih zahtevkov"
  },
  {
    "code": "714105",
    "name": "Prihodki od komunalnih prispevkov"
  },
  {
    "code": "714106",
    "name": "Prispevki in doplačila občanov za izvajanje določenih programov tekočega značaja"
  },
  {
    "code": "714107",
    "name": "Prispevki in doplačila občanov za izvajanje določenih programov investicijskega značaja"
  },
  {
    "code": "714108",
    "name": "Sredstva za investicije, pridobljena z občinskimi samoprispevki"
  },
  {
    "code": "714109",
    "name": "Sredstva za investicije, pridobljena s krajevnimi samoprispevki"
  },
  {
    "code": "714110",
    "name": "Zamudne obresti od komunalnih prispevkov"
  },
  {
    "code": "714111",
    "name": "Prihodki od zaračunljivih tiskovin - potnih listin"
  },
  {
    "code": "714112",
    "name": "Prihodki od zaračunljivih tiskovin - osebnih izkaznic"
  },
  {
    "code": "714113",
    "name": "Prihodki od zaračunljivih tiskovin - registrskih tablic"
  },
  {
    "code": "714114",
    "name": "Prihodki od ostalih zaračunljivih tiskovin"
  },
  {
    "code": "714115",
    "name": "Prihodki iz naslova zaračunanih stroškov razporejanja javnofinančnih prihodkov"
  },
  {
    "code": "714116",
    "name": "Nadomestila zaradi omejene rabe prostora na območju jedrskega objekta"
  },
  {
    "code": "714117",
    "name": "Prihodki storitev v postopkih homologacije in posamične odobritve vozil"
  },
  {
    "code": "714118",
    "name": "Prispevek za vzpodbujanje zaposlovanja invalidov"
  },
  {
    "code": "714119",
    "name": "Prihodki iz naslova nominalne vrednosti euro kovancev danih v obtok"
  },
  {
    "code": "714120",
    "name": "Prihodki iz naslova odškodnin iz sklenjenih zavarovanj"
  },
  {
    "code": "714121",
    "name": "Prihodki iz naslova unovčenih instrumentov za zavarovanje izvedbe posla"
  },
  {
    "code": "714122",
    "name": "Prihodki iz naslova prejetih provizij za dana poroštva"
  },
  {
    "code": "714123",
    "name": "Prispevek od presežnih tržnih prihodkov na področju energetike"
  },
  {
    "code": "714124",
    "name": "Solidarnostni prispevki"
  },
  {
    "code": "714199",
    "name": "Drugi izredni nedavčni prihodki"
  },
  {
    "code": "72",
    "name": "KAPITALSKI PRIHODKI"
  },
  {
    "code": "720",
    "name": "PRIHODKI OD PRODAJE OSNOVNIH SREDSTEV"
  },
  {
    "code": "7200",
    "name": "Prihodki od prodaje zgradb in prostorov"
  },
  {
    "code": "720000",
    "name": "Prihodki od prodaje poslovnih objektov in poslovnih prostorov"
  },
  {
    "code": "720001",
    "name": "Prihodki od prodaje stanovanjskih objektov in stanovanj"
  },
  {
    "code": "720099",
    "name": "Prihodki od prodaje drugih zgradb in prostorov"
  },
  {
    "code": "7201",
    "name": "Prihodki od prodaje prevoznih sredstev"
  },
  {
    "code": "720100",
    "name": "Prihodki od prodaje cestnih motornih vozil"
  },
  {
    "code": "720101",
    "name": "Prihodki od prodaje helikopterjev in letal"
  },
  {
    "code": "720102",
    "name": "Prihodki od prodaje ladij in čolnov"
  },
  {
    "code": "720199",
    "name": "Prihodki od prodaje drugih prevoznih sredstev"
  },
  {
    "code": "7202",
    "name": "Prihodki od prodaje opreme"
  },
  {
    "code": "720200",
    "name": "Prihodki od prodaje pisarniške opreme"
  },
  {
    "code": "720201",
    "name": "Prihodki od prodaje računalniške opreme"
  },
  {
    "code": "720299",
    "name": "Prihodki od prodaje druge opreme"
  },
  {
    "code": "7203",
    "name": "Prihodki od prodaje drugih osnovnih sredstev"
  },
  {
    "code": "720399",
    "name": "Prihodki od prodaje drugih osnovnih sredstev"
  },
  {
    "code": "721",
    "name": "PRIHODKI OD PRODAJE ZALOG"
  },
  {
    "code": "7210",
    "name": "Prihodki od prodaje blagovnih rezerv"
  },
  {
    "code": "721000",
    "name": "Prihodki od prodaje blagovnih rezerv"
  },
  {
    "code": "7211",
    "name": "Prihodki od prodaje drugih zalog"
  },
  {
    "code": "721199",
    "name": "Prihodki od prodaje drugih zalog"
  },
  {
    "code": "722",
    "name": "PRIHODKI OD PRODAJE ZEMLJIŠČ IN NEOPREDMETENIH SREDSTEV"
  },
  {
    "code": "7220",
    "name": "Prihodki od prodaje kmetijskih zemljišč in gozdov"
  },
  {
    "code": "722000",
    "name": "Prihodki od prodaje kmetijskih zemljišč"
  },
  {
    "code": "722001",
    "name": "Prihodki od prodaje gozdov"
  },
  {
    "code": "722002",
    "name": "Prihodki in obresti od prodaje vodnih zemljišč"
  },
  {
    "code": "7221",
    "name": "Prihodki od prodaje stavbnih zemljišč"
  },
  {
    "code": "722100",
    "name": "Prihodki od prodaje stavbnih zemljišč"
  },
  {
    "code": "7222",
    "name": "Prihodki od prodaje premoženjskih pravic in drugih neopredmetenih sredstev"
  },
  {
    "code": "722200",
    "name": "Prihodki od prodaje premoženjskih pravic in drugih neopredmetenih sredstev"
  },
  {
    "code": "73",
    "name": "PREJETE DONACIJE"
  },
  {
    "code": "730",
    "name": "PREJETE DONACIJE IZ DOMAČIH VIROV"
  },
  {
    "code": "7300",
    "name": "Prejete donacije in darila od domačih pravnih oseb"
  },
  {
    "code": "730000",
    "name": "Prejete donacije in darila od domačih pravnih oseb"
  },
  {
    "code": "7301",
    "name": "Prejete donacije in darila od domačih fizičnih oseb"
  },
  {
    "code": "730100",
    "name": "Prejete donacije in darila od domačih fizičnih oseb"
  },
  {
    "code": "731",
    "name": "PREJETE DONACIJE IZ TUJINE"
  },
  {
    "code": "7310",
    "name": "Prejete donacije in darila od tujih nevladnih organizacij in fundacij"
  },
  {
    "code": "731000",
    "name": "Prejete donacije in darila od tujih nevladnih organizacij in fundacij"
  },
  {
    "code": "7311",
    "name": "Prejete donacije in darila od tujih vlad in vladnih institucij"
  },
  {
    "code": "731100",
    "name": "Prejete donacije in darila od tujih vlad in vladnih institucij"
  },
  {
    "code": "7312",
    "name": "Prejete donacije in darila od tujih pravnih oseb"
  },
  {
    "code": "731200",
    "name": "Prejete donacije in darila od tujih pravnih oseb"
  },
  {
    "code": "7313",
    "name": "Prejete donacije in darila od tujih fizičnih oseb"
  },
  {
    "code": "731300",
    "name": "Prejete donacije in darila od tujih fizičnih oseb"
  },
  {
    "code": "74",
    "name": "TRANSFERNI PRIHODKI"
  },
  {
    "code": "740",
    "name": "TRANSFERNI PRIHODKI IZ DRUGIH JAVNOFINANČNIH INSTITUCIJ"
  },
  {
    "code": "7400",
    "name": "Prejeta sredstva iz državnega proračuna"
  },
  {
    "code": "740000",
    "name": "Prejeta sredstva iz naslova tekočih obveznosti državnega proračuna"
  },
  {
    "code": "740001",
    "name": "Prejeta sredstva iz državnega proračuna za investicije"
  },
  {
    "code": "740002",
    "name": "Prejeta sredstva iz državnega proračuna iz naslova dodatnih obveznosti do ZPIZ Prejeta sredstva iz državnega proračuna iz naslova prispevka za zdravstveno zavarovanje"
  },
  {
    "code": "740003",
    "name": "določenih oseb"
  },
  {
    "code": "740004",
    "name": "Druga prejeta sredstva iz državnega proračuna za tekočo porabo Prejeta sredstva iz naslova prispevka delodajalca za pokojninsko in invalidsko zavarovanje od"
  },
  {
    "code": "740006",
    "name": "starševskih nadomestil Prejeta sredstva iz naslova prispevka delodajalca za zdravstveno zavarovanje od starševskih"
  },
  {
    "code": "740007",
    "name": "nadomestil"
  },
  {
    "code": "740008",
    "name": "Prejeta sredstva iz naslova prispevka delodajalca za zaposlovanje od starševskih nadomestil Prejeta sredstva iz naslova prispevka delodajalca za starševsko varstvo od starševskih"
  },
  {
    "code": "740009",
    "name": "nadomestil Prejeta sredstva iz naslova prispevka delodajalca za pokojninsko in invalidsko zavarovanje od"
  },
  {
    "code": "740010",
    "name": "nadomestil za čas brezposelnosti Prejeta sredstva iz naslova prispevka delodajalca za zdravstveno zavarovanje od nadomestil za"
  },
  {
    "code": "740011",
    "name": "čas brezposelnosti Prejeta sredstva iz naslova prispevka delodajalca za zaposlovanje od nadomestil za čas"
  },
  {
    "code": "740012",
    "name": "brezposelnosti Prejeta sredstva iz naslova prispevka delodajalca za starševsko varstvo od nadomestil za čas"
  },
  {
    "code": "740013",
    "name": "brezposelnosti Prejeta sredstva iz naslova prispevka delodajalca za zdravstveno zavarovanje vojaških"
  },
  {
    "code": "740014",
    "name": "obveznikov, ki služijo vojaški rok Prejeta sredstva iz naslova prispevka delodajalca za poškodbe pri delu in poklicne bolezni za"
  },
  {
    "code": "740015",
    "name": "vojaške obveznike, ki služijo vojaški rok Prejeta sredstva iz državnega proračuna iz naslova prispevka delodajalca za zdravstveno"
  },
  {
    "code": "740016",
    "name": "zavarovanje zapornikov"
  },
  {
    "code": "740017",
    "name": "Prejeta sredstva iz naslova razlike do polne vrednosti zdravstvenih storitev za socialno ogrožene"
  },
  {
    "code": "740019",
    "name": "Prejeta sredstva iz državnega proračuna za uravnoteženje razvitosti občin Prejeta sredstva iz državnega proračuna za odpravo posledic naravnih nesreč in drugih izrednih"
  },
  {
    "code": "740020",
    "name": "dogodkov Prejeta sredstva iz državnega proračuna iz naslova prispevka za dolgotrajno oskrbo za določene"
  },
  {
    "code": "740021",
    "name": "osebe"
  },
  {
    "code": "7401",
    "name": "Prejeta sredstva iz občinskih proračunov"
  },
  {
    "code": "740100",
    "name": "Prejeta sredstva iz občinskih proračunov za tekočo porabo"
  },
  {
    "code": "740101",
    "name": "Prejeta sredstva iz občinskih proračunov za investicije Prejeta sredstva iz občinskih proračunov iz naslova plačila prispevkov za zdravstveno"
  },
  {
    "code": "740102",
    "name": "zavarovanje določenih oseb"
  },
  {
    "code": "7402",
    "name": "Prejeta sredstva iz skladov socialnega zavarovanja"
  },
  {
    "code": "740200",
    "name": "Prejeta sredstva iz skladov socialnega zavarovanja za tekočo porabo"
  },
  {
    "code": "740201",
    "name": "Prejeta sredstva iz skladov socialnega zavarovanja za investicije"
  },
  {
    "code": "740202",
    "name": "Prejeta sredstva iz ZPIZ iz naslova prispevka za zdravstveno zavarovanje upokojencev Prejeta sredstva iz naslova prispevka delodajalca za pokojninsko in invalidsko zavarovanje od"
  },
  {
    "code": "740203",
    "name": "nadomestil zaradi bolezenske odsotnosti, ki jih ZZZS neposredno izplačuje upravičencem Prejeta sredstva iz naslova prispevka delodajalca za zdravstveno zavarovanje od nadomestil"
  },
  {
    "code": "740204",
    "name": "zaradi bolezenske odsotnosti, ki jih ZZZS neposredno izplačuje upravičencem Prejeta sredstva iz naslova prispevka delodajalca za zaposlovanje od nadomestil zaradi"
  },
  {
    "code": "740205",
    "name": "bolezenske odsotnosti, ki jih ZZZS neposredno izplačuje upravičencem Prejeta sredstva iz naslova prispevka delodajalca za starševsko varstvo od nadomestil zaradi"
  },
  {
    "code": "740206",
    "name": "bolezenske odsotnosti, ki jih ZZZS neposredno izplačuje upravičencem Prejeta sredstva iz naslova prispevka delodajalca za zdravstveno zavarovanje od nadomestil iz"
  },
  {
    "code": "740207",
    "name": "invalidskega zavarovanja, ki jih ZPIZ neposredno izplačuje upravičencem Prejeta sredstva iz naslova prispevka delodajalca za zaposlovanje od nadomestil iz invalidskega"
  },
  {
    "code": "740208",
    "name": "zavarovanja, ki jih ZPIZ neposredno izplačuje upravičencem Prejeta sredstva iz naslova prispevka delodajalca za starševsko varstvo od nadomestil iz"
  },
  {
    "code": "740209",
    "name": "invalidskega zavarovanja, ki jih ZPIZ neposredno izplačuje upravičencem"
  },
  {
    "code": "7403",
    "name": "Prejeta sredstva iz javnih skladov"
  },
  {
    "code": "740300",
    "name": "Prejeta sredstva iz javnih skladov za tekočo porabo"
  },
  {
    "code": "740301",
    "name": "Prejeta sredstva iz javnih skladov za investicije"
  },
  {
    "code": "7404",
    "name": "Prejeta sredstva iz javnih agencij in javnih zavodov"
  },
  {
    "code": "740400",
    "name": "Prejeta sredstva iz javnih agencij in javnih zavodov za tekočo porabo"
  },
  {
    "code": "740401",
    "name": "Prejeta sredstva iz javnih agencij in javnih zavodov za investicije PREJETA SREDSTVA IZ DRŽAVNEGA PRORAČUNA IZ SREDSTEV PRORAČUNA EU IN IZ"
  },
  {
    "code": "741",
    "name": "DRUGIH DRŽAV"
  },
  {
    "code": "7410",
    "name": "Prejeta sredstva iz državnega proračuna iz predpristopnih in popristopnih pomoči EU"
  },
  {
    "code": "741000",
    "name": "Prejeta sredstva iz državnega proračuna iz predpristopnih in popristopnih pomoči EU Prejeta sredstva iz državnega proračuna iz sredstev proračuna EU za izvajanje skupne kmetijske"
  },
  {
    "code": "7411",
    "name": "in ribiške politike Prejeta sredstva iz državnega proračuna iz sredstev proračuna EU za izvajanje skupne kmetijske"
  },
  {
    "code": "741100",
    "name": "politike Prejeta sredstva iz državnega proračuna iz sredstev proračuna EU za izvajanje skupne kmetijske"
  },
  {
    "code": "741101",
    "name": "in ribiške politike za obdobje 2014 - 2020"
  },
  {
    "code": "7412",
    "name": "Prejeta sredstva iz državnega proračuna iz sredstev proračuna EU iz strukturnih skladov"
  },
  {
    "code": "741200",
    "name": "Prejeta sredstva iz državnega proračuna iz sredstev proračuna EU iz strukturnih skladov Prejeta sredstva iz državnega proračuna iz sredstev proračuna EU iz strukturnih skladov za"
  },
  {
    "code": "741201",
    "name": "obdobje 2014 - 2020 Prejeta sredstva iz državnega proračuna iz sredstev proračuna EU iz Pobude za zaposlovanje"
  },
  {
    "code": "741202",
    "name": "mladih (YEI) za obdobje 2014 - 2020 Prejeta sredstva iz državnega proračuna iz sredstev proračuna EU iz Sklada za evropsko pomoč"
  },
  {
    "code": "741203",
    "name": "najbolj ogroženim za obdobje 2014 - 2020"
  },
  {
    "code": "7413",
    "name": "Prejeta sredstva iz državnega proračuna iz sredstev proračuna EU iz kohezijskega sklada"
  },
  {
    "code": "741300",
    "name": "Prejeta sredstva iz državnega proračuna iz sredstev proračuna EU iz kohezijskega sklada"
  },
  {
    "code": "741301",
    "name": "obdobje 2014 - 2020 Prejeta sredstva iz državnega proračuna iz sredstev proračuna EU za izvajanje centraliziranih in"
  },
  {
    "code": "7414",
    "name": "drugih programov EU Prejeta sredstva iz državnega proračuna iz sredstev proračuna EU za izvajanje centraliziranih in"
  },
  {
    "code": "741400",
    "name": "drugih programov EU Prejeta sredstva iz državnega proračuna iz sredstev proračuna EU za izvajanje centraliziranih in"
  },
  {
    "code": "741401",
    "name": "drugih programov EU za obdobje 2014 - 2020"
  },
  {
    "code": "7415",
    "name": "Prejeta sredstva iz državnega proračuna iz sredstev proračuna EU iz naslova pavšalnih povračil"
  },
  {
    "code": "741500",
    "name": "Prejeta sredstva iz državnega proračuna iz sredstev proračuna EU iz naslova pavšalnih povračil"
  },
  {
    "code": "7416",
    "name": "Druga prejeta sredstva iz državnega proračuna iz sredstev proračuna EU"
  },
  {
    "code": "741600",
    "name": "Druga prejeta sredstva iz državnega proračuna iz sredstev proračuna EU"
  },
  {
    "code": "741601",
    "name": "Druga prejeta sredstva iz državnega proračuna iz sredstev proračuna EU - sredstva za NOO"
  },
  {
    "code": "7417",
    "name": "Prejeta sredstva iz državnega proračuna iz sredstev drugih evropskih institucij in iz drugih držav"
  },
  {
    "code": "741700",
    "name": "Prejeta sredstva iz državnega proračuna iz sredstev drugih evropskih institucij"
  },
  {
    "code": "741701",
    "name": "Prejeta sredstva iz državnega proračuna iz sredstev Švicarskega prispevka Prejeta sredstva iz državnega proračuna iz sredstev Norveškega finančnega mehanizma in"
  },
  {
    "code": "741702",
    "name": "Finančnega mehanizma EGP"
  },
  {
    "code": "75",
    "name": "PREJETA VRAČILA DANIH POSOJIL IN ZMANJŠANJE FINANČNIH NALOŽB"
  },
  {
    "code": "750",
    "name": "PREJETA VRAČILA DANIH POSOJIL"
  },
  {
    "code": "7500",
    "name": "Prejeta vračila danih posojil od posameznikov in zasebnikov"
  },
  {
    "code": "750000",
    "name": "Prejeta vračila danih posojil od posameznikov in zasebnikov - kratkoročna posojila"
  },
  {
    "code": "750001",
    "name": "Prejeta vračila danih posojil od posameznikov in zasebnikov - dolgoročna posojila"
  },
  {
    "code": "7501",
    "name": "Prejeta vračila danih posojil od javnih skladov"
  },
  {
    "code": "750100",
    "name": "Prejeta vračila danih posojil od javnih skladov - kratkoročna posojila"
  },
  {
    "code": "750101",
    "name": "Prejeta vračila danih posojil od javnih skladov - dolgoročna posojila"
  },
  {
    "code": "7502",
    "name": "Prejeta vračila danih posojil od javnih podjetij in družb, ki so v lasti države ali občin Prejeta vračila danih posojil od javnih podjetij in družb, ki so v lasti države ali občin - kratkoročna"
  },
  {
    "code": "750200",
    "name": "posojila Prejeta vračila danih posojil od javnih podjetij in družb, ki so v lasti države ali občin - dolgoročna"
  },
  {
    "code": "750201",
    "name": "posojila"
  },
  {
    "code": "7503",
    "name": "Prejeta vračila danih posojil od finančnih institucij"
  },
  {
    "code": "750300",
    "name": "Prejeta vračila danih posojil od finančnih institucij - kratkoročna posojila"
  },
  {
    "code": "750301",
    "name": "Prejeta vračila danih posojil od finančnih institucij - dolgoročna posojila"
  },
  {
    "code": "7504",
    "name": "Prejeta vračila danih posojil od privatnih podjetij"
  },
  {
    "code": "750400",
    "name": "Prejeta vračila danih posojil od privatnih podjetij - kratkoročna posojila"
  },
  {
    "code": "750401",
    "name": "Prejeta vračila danih posojil od privatnih podjetij - dolgoročna posojila"
  },
  {
    "code": "750402",
    "name": "Prejete obresti od danih posojil privatnim podjetjem iz naslova kupnin"
  },
  {
    "code": "7505",
    "name": "Prejeta vračila danih posojil od občin"
  },
  {
    "code": "750500",
    "name": "Prejeta vračila danih posojil od občin - kratkoročna posojila"
  },
  {
    "code": "750501",
    "name": "Prejeta vračila danih posojil od občin - dolgoročna posojila"
  },
  {
    "code": "7506",
    "name": "Prejeta vračila danih posojil iz tujine"
  },
  {
    "code": "750600",
    "name": "Prejeta vračila danih posojil iz tujine - kratkoročna posojila"
  },
  {
    "code": "750601",
    "name": "Prejeta vračila danih posojil iz tujine - dolgoročna posojila"
  },
  {
    "code": "7507",
    "name": "Prejeta vračila danih posojil državnemu proračunu"
  },
  {
    "code": "750700",
    "name": "Prejeta vračila danih posojil državnemu proračunu - kratkoročna posojila"
  },
  {
    "code": "750701",
    "name": "Prejeta vračila danih posojil državnemu proračunu - dolgoročna posojila"
  },
  {
    "code": "7508",
    "name": "Prejeta vračila danih posojil od javnih agencij in javnih zavodov"
  },
  {
    "code": "750800",
    "name": "Prejeta vračila danih posojil od javnih agencij in javnih zavodov - kratkoročna posojila"
  },
  {
    "code": "750801",
    "name": "Prejeta vračila danih posojil od javnih agencij in javnih zavodov - dolgoročna posojila"
  },
  {
    "code": "7509",
    "name": "Prejeta vračila plačanih poroštev"
  },
  {
    "code": "750900",
    "name": "Prejeta vračila plačanih poroštev javnim podjetjem in družbam, ki so v lasti države ali občin"
  },
  {
    "code": "750901",
    "name": "Prejeta vračila plačanih poroštev privatnim podjetjem"
  },
  {
    "code": "750902",
    "name": "Prejeta vračila plačanih poroštev finančnim institucijam"
  },
  {
    "code": "750999",
    "name": "Prejeta vračila plačanih poroštev drugim"
  },
  {
    "code": "751",
    "name": "ZMANJŠANJE FINANČNIH NALOŽB Sredstva, pridobljena s prodajo kapitalskih deležev in drugih zmanjšanj kapitala v javnih podjetjih"
  },
  {
    "code": "7510",
    "name": "in družbah, ki so v lasti države ali občin Sredstva, pridobljena s prodajo kapitalskih deležev v javnih podjetjih in družbah, ki so v lasti"
  },
  {
    "code": "751000",
    "name": "države ali občin Prejeta vračila naknadnih vplačil kapitala v javnih podjetjih in družbah, ki so v lasti države ali"
  },
  {
    "code": "751001",
    "name": "občin Sredstva, pridobljena s prodajo kapitalskih deležev in drugih zmanjšanj kapitala v finančnih"
  },
  {
    "code": "7511",
    "name": "institucijah Sredstva, pridobljena s prodajo kapitalskih deležev in drugih zmanjšanj kapitala v finančnih"
  },
  {
    "code": "751100",
    "name": "institucijah Sredstva, pridobljena s prodajo kapitalskih deležev in drugih zmanjšanj kapitala v privatnih"
  },
  {
    "code": "7512",
    "name": "podjetjih Sredstva, pridobljena s prodajo kapitalskih deležev in drugih zmanjšanj kapitala v privatnih"
  },
  {
    "code": "751200",
    "name": "podjetjih"
  },
  {
    "code": "7513",
    "name": "Sredstva, pridobljena s prodajo drugih kapitalskih deležev doma in v tujini"
  },
  {
    "code": "751300",
    "name": "Sredstva, pridobljena s prodajo drugih kapitalskih deležev doma in v tujini"
  },
  {
    "code": "7514",
    "name": "Prejeta vračila namenskega premoženja"
  },
  {
    "code": "751400",
    "name": "Prejeta vračila namenskega premoženja"
  },
  {
    "code": "752",
    "name": "KUPNINE IZ NASLOVA PRIVATIZACIJE"
  },
  {
    "code": "7520",
    "name": "Sredstva kupnin iz naslova privatizacije"
  },
  {
    "code": "752000",
    "name": "Prejeta sredstva kupnin iz naslova privatizacije"
  },
  {
    "code": "752001",
    "name": "Prejete obresti od vezanih depozitov iz sredstev kupnin"
  },
  {
    "code": "752002",
    "name": "Druge prejete obresti iz sredstev kupnin"
  },
  {
    "code": "753",
    "name": "Prejeta vračila danih posojil subjektom, vključenim v enotno upravljanje sredstev sistema EZR"
  },
  {
    "code": "7530",
    "name": "Prejeta vračila danih posojil subjektom, vključenim v enotno upravljanje sredstev sistema EZR Prejeta vračila danih likvidnostnih in kratkoročnih posojil subjektom, vključenim v enotno"
  },
  {
    "code": "753000",
    "name": "upravljanje sredstev sistema EZR Prejeta vračila danih dolgoročnih posojil subjektom, vključenim v enotno upravljanje sredstev"
  },
  {
    "code": "753002",
    "name": "sistema EZR"
  },
  {
    "code": "76",
    "name": "ZARAČUNANI PRIHODKI DOLOČENIH UPORABNIKOV ENOTNEGA KONTNEGA NAČRTA"
  },
  {
    "code": "760",
    "name": "PRIHODKI IZ JAVNIH FINANC IN NEJAVNIH VIROV ZA OPRAVLJANJE JAVNE SLUŽBE"
  },
  {
    "code": "761",
    "name": "PRIHODKI OD PRODAJE PROIZVODOV, BLAGA IN STORITEV NA TRGU"
  },
  {
    "code": "762",
    "name": "FINANČNI PRIHODKI"
  },
  {
    "code": "763",
    "name": "DRUGI PRIHODKI"
  },
  {
    "code": "764",
    "name": "PREVREDNOTOVALNI POSLOVNI PRIHODKI"
  },
  {
    "code": "78",
    "name": "PREJETA SREDSTVA IZ EU IN IZ DRUGIH DRŽAV PREJETA SREDSTVA IZ PRORAČUNA EU ZA IZVAJANJE SKUPNE KMETIJSKE IN RIBIŠKE"
  },
  {
    "code": "781",
    "name": "POLITIKE Prejeta sredstva iz proračuna EU iz naslova tržnih ukrepov v kmetijstvu iz Evropskega"
  },
  {
    "code": "7810",
    "name": "kmetijskega jamstvenega in usmerjevalnega sklada - Jamstveni del (EAGGF - Guarantee Fund) in Evropskega kmetijskega jamstvenega sklada (EKJS)"
  },
  {
    "code": "781000",
    "name": "Prejeta sredstva iz proračuna EU iz naslova tržnih ukrepov v kmetijstvu"
  },
  {
    "code": "781001",
    "name": "Prejete obresti od sredstev iz proračuna EU iz naslova tržnih ukrepov v kmetijstvu Prejeta sredstva iz proračuna EU iz naslova tržnih ukrepov v kmetijstvu za obdobje NFP 2007 -"
  },
  {
    "code": "781002",
    "name": "2013 Prejete obresti od sredstev iz proračuna EU iz naslova tržnih ukrepov v kmetijstvu za obdobje"
  },
  {
    "code": "781003",
    "name": "NFP 2007 - 2013"
  },
  {
    "code": "781004",
    "name": "Prejeta sredstva iz proračuna EU iz naslova tržnih ukrepov v kmetijstvu za obdobje 2014 - 2020 Prejete obresti od sredstev iz proračuna EU iz naslova tržnih ukrepov v kmetijstvu za obdobje"
  },
  {
    "code": "781005",
    "name": "2014 - 2020 Prejeta sredstva iz proračuna EU iz naslova neposrednih plačil v kmetijstvu iz Evropskega"
  },
  {
    "code": "7811",
    "name": "kmetijskega jamstvenega in usmerjevalnega sklada - Jamstveni del (EAGGF - Guarantee Fund) in Evropskega kmetijskega jamstvenega sklada (EKJS)"
  },
  {
    "code": "781100",
    "name": "Prejeta sredstva iz proračuna EU iz naslova neposrednih plačil v kmetijstvu"
  },
  {
    "code": "781101",
    "name": "Prejete obresti od sredstev iz proračuna EU iz naslova neposrednih plačil v kmetijstvu Prejeta sredstva iz proračuna EU iz naslova neposrednih plačil v kmetijstvu za obdobje NFP"
  },
  {
    "code": "781102",
    "name": "2007 - 2013 Prejete obresti od sredstev iz proračuna EU iz naslova neposrednih plačil v kmetijstvu za obdobje"
  },
  {
    "code": "781103",
    "name": "NFP 2007 - 2013 Prejeta sredstva iz proračuna EU iz naslova neposrednih plačil v kmetijstvu za obdobje 2014 -"
  },
  {
    "code": "781104",
    "name": "2020 Prejete obresti od sredstev iz proračuna EU iz naslova neposrednih plačil v kmetijstvu za obdobje"
  },
  {
    "code": "781105",
    "name": "2014 - 2020"
  },
  {
    "code": "781106",
    "name": "Prejeta sredstva iz proračuna EU iz naslova neposrednih plačil EAGGF (EKJS) 2023 - 2027 Prejeta sredstva iz proračuna EU iz naslova Programa razvoja podeželja iz Evropskega"
  },
  {
    "code": "7812",
    "name": "kmetijskega jamstvenega in usmerjevalnega sklada - Jamstveni del (EAGGF - Guarantee Fund) in Evropskega kmetijskega sklada za razvoj podeželja (EKSRP)"
  },
  {
    "code": "781200",
    "name": "Prejeta sredstva iz proračuna EU za območja s težjimi razmerami za kmetovanje - ECO 1"
  },
  {
    "code": "781201",
    "name": "Prejeta sredstva iz proračuna EU za slovenski kmetijski okoljski program - ECO 2, ECO 3"
  },
  {
    "code": "781202",
    "name": "Prejeta sredstva iz poračuna EU za zgodnje upokojevanje"
  },
  {
    "code": "781203",
    "name": "Prejeta sredstva iz proračuna EU za organizacije proizvajalcev"
  },
  {
    "code": "781204",
    "name": "Prejeta sredstva iz proračuna EU za tehnično pomoč"
  },
  {
    "code": "781205",
    "name": "Prejeta sredstva iz proračuna EU za pogozdovanje"
  },
  {
    "code": "781206",
    "name": "Prejeta sredstva iz proračuna EU za ukrep EU standardi"
  },
  {
    "code": "781207",
    "name": "Prejete obresti od sredstev iz proračuna EU iz naslova Programa razvoja podeželja Prejeta sredstva iz proračuna EU iz naslova Programa razvoja podeželja za ukrep dopolnil k"
  },
  {
    "code": "781208",
    "name": "neposrednim plačilom"
  },
  {
    "code": "781209",
    "name": "Prejeta sredstva iz proračuna EU iz naslova Programa razvoja podeželja za ukrep SAPARD Prejeta sredstva iz proračuna EU iz naslova Programa razvoja podeželja za obdobje NFP 2007 -"
  },
  {
    "code": "781210",
    "name": "2013"
  },
  {
    "code": "781211",
    "name": "Prejeta sredstva iz proračuna EU iz naslova Programa razvoja podeželja za obdobje 2014 - 2020 Prejeta sredstva iz proračuna EU iz naslova ukrepov skupnega strateškega načrta EAFRD"
  },
  {
    "code": "781212",
    "name": "(EKSRP) 2023 - 2027"
  },
  {
    "code": "781213",
    "name": "Prejeta sredstva iz proračuna EU iz naslova Programa razvoja podeželja"
  },
  {
    "code": "7813",
    "name": "Ostala prejeta sredstva iz proračuna EU za izvajanje skupne kmetijske politike"
  },
  {
    "code": "781300",
    "name": "Prejeta sredstva iz proračuna EU iz naslova ukrepa FADN Prejeta sredstva iz proračuna EU iz naslova ukrepov v čebelarstvu iz Evropskega kmetijskega"
  },
  {
    "code": "781301",
    "name": "jamstvenega in usmerjevalnega sklada - Jamstveni del (EAGGF - Guarantee Fund) Prejeta sredstva iz proračuna EU iz naslova informiranja in promocije iz Evropskega kmetijskega"
  },
  {
    "code": "781302",
    "name": "jamstvenega in usmerjevalnega sklada - Jamstveni del (EAGGF - Guarantee Fund) Prejeta sredstva iz proračuna EU iz naslova ukrepov v veterini iz Evropskega kmetijskega"
  },
  {
    "code": "781303",
    "name": "jamstvenega in usmerjevalnega sklada - Jamstveni del (EAGGF - Guarantee Fund) Prejeta sredstva iz proračuna EU iz naslova fitosanitarnih ukrepov Evropskega kmetijskega"
  },
  {
    "code": "781304",
    "name": "jamstvenega in usmerjevalnega sklada - Jamstveni del (EAGGF - Guarantee Fund) Prejeta sredstva iz proračuna EU iz naslova ukrepov v veterini iz Evropskega kmetijskega"
  },
  {
    "code": "781307",
    "name": "jamstvenega sklada (EKJS) za obdobje NFP 2007 - 2013 Prejeta sredstva iz proračuna EU iz naslova fitosanitarnih ukrepov iz Evropskega kmetijskega"
  },
  {
    "code": "781308",
    "name": "jamstvenega sklada (EKJS) za obdobje NFP 2007 - 2013"
  },
  {
    "code": "781309",
    "name": "Prejete obresti od ostalih prejetih sredstev iz proračuna EU za izvajanje skupne kmetijske politike Prejeta sredstva iz proračuna EU iz naslova ukrepov v čebelarstvu iz Evropskega kmetijskega"
  },
  {
    "code": "781310",
    "name": "jamstvenega sklada (EKJS) za obdobje 2014 - 2020 Prejeta sredstva iz proračuna EU iz naslova informiranja in promocije iz Evropskega kmetijskega"
  },
  {
    "code": "781311",
    "name": "jamstvenega sklada (EKJS) za obdobje 2014 - 2020 Prejeta sredstva iz proračuna EU za shemo šolskega sadja in zelenjave iz Evropskega"
  },
  {
    "code": "781312",
    "name": "kmetijskega jamstvenega sklada (EKJS) za obdobje 2014 - 2020 Prejeta sredstva iz proračuna EU za shemo šolskega sadja in zelenjave iz Evropskega"
  },
  {
    "code": "781313",
    "name": "kmetijskega jamstvenega sklada (EKJS)"
  },
  {
    "code": "781314",
    "name": "Prejeta sredstva iz proračuna EU iz naslova ukrepov skupnega strateškega načrta"
  },
  {
    "code": "781399",
    "name": "Ostala prejeta sredstva iz proračuna EU za izvajanje skupne kmetijske politike"
  },
  {
    "code": "7814",
    "name": "Prejeta sredstva iz proračuna EU za izvajanje skupne ribiške politike Prejeta sredstva iz proračuna EU iz naslova ukrepov v ribištvu iz Evropskega sklada za ribištvo"
  },
  {
    "code": "781400",
    "name": "(ESR) za obdobje NFP 2007 - 2013 Prejeta sredstva iz proračuna EU iz naslova ostalih ukrepov v ribištvu za financiranje ukrepov"
  },
  {
    "code": "781401",
    "name": "skupne ribiške politike za obdobje NFP 2007 - 2013 Prejeta sredstva iz proračuna EU iz naslova ostalih ukrepov v ribištvu za financiranje ukrepov"
  },
  {
    "code": "781402",
    "name": "skupne ribiške politike"
  },
  {
    "code": "781403",
    "name": "Prejete obresti od sredstev iz proračuna EU za financiranje ukrepov skupne ribiške politike Prejeta sredstva iz proračuna EU iz naslova ukrepov v ribištvu iz Evropskega sklada za"
  },
  {
    "code": "781404",
    "name": "pomorstvo in ribištvo (ESPR) za obdobje 2014 - 2020 Prejeta sredstva iz proračuna EU iz naslova ukrepov v ribištvu iz EMFAF (ESPRA) za obdobje"
  },
  {
    "code": "781405",
    "name": "2021 - 2027"
  },
  {
    "code": "782",
    "name": "PREJETA SREDSTVA IZ PRORAČUNA EU IZ STRUKTURNIH SKLADOV"
  },
  {
    "code": "7821",
    "name": "Prejeta sredstva iz proračuna EU iz Evropskega sklada za regionalni razvoj (ERDF) Prejeta sredstva iz naslova Operativnega programa krepitve regionalnih razvojnih potencialov"
  },
  {
    "code": "782106",
    "name": "2007 - 2013 Prejete obresti od sredstev iz naslova Operativnega programa krepitve regionalnih razvojnih"
  },
  {
    "code": "782107",
    "name": "potencialov 2007 - 2013 Prejeta sredstva iz strukturnih skladov iz naslova Operativnega programa razvoja okoljske in"
  },
  {
    "code": "782108",
    "name": "prometne infrastrukture 2007 - 2013 Prejete obresti od sredstev iz strukturnih skladov iz naslova Operativnega programa razvoja"
  },
  {
    "code": "782109",
    "name": "okoljske in prometne infrastrukture 2007 - 2013 Prejeta sredstva iz ERDF iz naslova Operativnega programa za izvajanje Evropske kohezijske"
  },
  {
    "code": "782118",
    "name": "politike za obdobje 2014 - 2020"
  },
  {
    "code": "782119",
    "name": "Prejete obresti od sredstev sklada ERDF (ESRR) iz naslova Kohezijske politike"
  },
  {
    "code": "782120",
    "name": "Prejeta sredstva iz naslova Evropskega teritorialnega sodelovanja 2014 - 2020 Prejete obresti od sredstev sklada ERDF (ESRR) iz naslova Interreg (Evropsko teritorialno"
  },
  {
    "code": "782121",
    "name": "sodelovanje)"
  },
  {
    "code": "782122",
    "name": "Prejeta sredstva sklada ERDF (ESRR) Kohezijska politika 2021 - 2027"
  },
  {
    "code": "782123",
    "name": "Prejeta sredstva sklada ESRR Interreg (Evropsko teritorialno sodelovanje) 2021 - 2027"
  },
  {
    "code": "782124",
    "name": "Prejeta sredstva sklada JTF (SPP) Kohezijska politika 2021 - 2027"
  },
  {
    "code": "782125",
    "name": "Prejete obresti sklada JTF (SPP) Kohezijska politika 2021 - 2027"
  },
  {
    "code": "7822",
    "name": "Prejeta sredstva iz Evropskega socialnega sklada (ESF) Prejeta sredstva iz ESF iz naslova Operativnega programa za izvajanje Evropske kohezijske"
  },
  {
    "code": "782206",
    "name": "politike za obdobje 2014 - 2020"
  },
  {
    "code": "782207",
    "name": "Prejete obresti od sredstev sklada ESF (ESS)"
  },
  {
    "code": "782208",
    "name": "Prejeta sredstva sklada ESF+ (ESS+) Kohezijska politika 2021 - 2027 Prejeta sredstva iz proračuna EU iz naslova Finančnega instrumenta za usmerjanje ribištva"
  },
  {
    "code": "7823",
    "name": "(FIFG)"
  },
  {
    "code": "7824",
    "name": "Prejeta sredstva iz proračuna EU iz naslova Pobude za zaposlovanje mladih (YEI) Prejeta sredstva iz proračuna EU iz naslova Pobude za zaposlovanje mladih (YEI) za obdobje"
  },
  {
    "code": "782400",
    "name": "2014 - 2020 Prejete obresti od sredstev iz proračuna EU iz naslova Pobude za zaposlovanje mladih (YEI) za"
  },
  {
    "code": "782401",
    "name": "obdobje 2014 - 2020"
  },
  {
    "code": "7825",
    "name": "Prejeta sredstva iz proračuna EU iz naslova Sklada za evropsko pomoč najbolj ogroženim Prejeta sredstva iz proračuna EU iz naslova Sklada za evropsko pomoč najbolj ogroženim za"
  },
  {
    "code": "782500",
    "name": "obdobje 2014 - 2020 Prejete obresti od sredstev iz proračuna EU iz naslova Sklada za evropsko pomoč najbolj"
  },
  {
    "code": "782501",
    "name": "ogroženim za obdobje 2014 - 2020 Prejeta sredstva iz proračuna EU iz naslova Sklada za evropsko pomoč najbolj ogroženim za"
  },
  {
    "code": "782502",
    "name": "obdobje 2021 - 2027 Prejete obresti od sredstev iz proračuna EU iz naslova Sklada za evropsko pomoč najbolj"
  },
  {
    "code": "782503",
    "name": "ogroženim za obdobje 2021 - 2027"
  },
  {
    "code": "783",
    "name": "PREJETA SREDSTVA IZ PRORAČUNA EU IZ KOHEZIJSKEGA SKLADA"
  },
  {
    "code": "7830",
    "name": "Prejeta sredstva iz Kohezijskega sklada (CF)"
  },
  {
    "code": "783006",
    "name": "politike za obdobje 2014 - 2020"
  },
  {
    "code": "783007",
    "name": "Prejete obresti iz sklada CF (KS)"
  },
  {
    "code": "783008",
    "name": "Prejeta sredstva sklada CF (KS) Kohezijska politika 2021 - 2027 PREJETA SREDSTVA IZ PRORAČUNA EU ZA IZVAJANJE CENTRALIZIRANIH IN DRUGIH"
  },
  {
    "code": "784",
    "name": "PROGRAMOV EU"
  },
  {
    "code": "7842",
    "name": "Prejeta sredstva iz proračuna EU iz naslova Konkurenčnost za rast in zaposlovanje Prejeta sredstva iz proračuna EU iz naslova Instrumenta za povezovanje Evrope (CEF) za"
  },
  {
    "code": "784204",
    "name": "obdobje 2014 - 2020"
  },
  {
    "code": "784205",
    "name": "Prejete obresti iz naslova CEF (Instrument za povezovanje Evrope) Druga prejeta sredstva iz proračuna EU iz naslova Konkurenčnost za rast in zaposlovanje za"
  },
  {
    "code": "784206",
    "name": "obdobje 2014 - 2020 Prejete obresti iz naslova ostalih sredstev za enotni trg, inovacije, digitalizacijo, kohezijo,"
  },
  {
    "code": "784207",
    "name": "odpornost in vrednote"
  },
  {
    "code": "784208",
    "name": "Prejeta sredstva iz proračuna EU - instrumenti za povezovanje Evrope za obdobje 2021 - 2027 Prejeta sredstva iz proračuna EU - ostala sredstva za enotni trg, inovacije, digitalizacijo, kohezijo,"
  },
  {
    "code": "784209",
    "name": "odpornost in vrednote za obdobje 2021 - 2027"
  },
  {
    "code": "784210",
    "name": "Druga prejeta sredstva iz proračuna EU iz naslova Konkurenčnost za rast in zaposlovanje"
  },
  {
    "code": "7843",
    "name": "Prejeta sredstva iz proračuna EU iz naslova Državljanstvo, svoboda, varnost in pravica"
  },
  {
    "code": "784308",
    "name": "Prejeta sredstva iz proračuna EU iz naslova Solidarnostnega sklada"
  },
  {
    "code": "784309",
    "name": "Prejete obresti od sredstev iz proračuna EU iz naslova Solidarnostnega sklada Prejeta sredstva iz proračuna EU iz naslova Sklada za azil, migracije in vključevanje za obdobje"
  },
  {
    "code": "784312",
    "name": "2014 - 2020"
  },
  {
    "code": "784313",
    "name": "Prejete obresti iz naslova AMIF (Sklad za azil, migracije in vključevanje) za obdobje 2014 - 2020"
  },
  {
    "code": "784314",
    "name": "Prejeta sredstva iz proračuna EU iz naslova Sklada za notranjo varnost za obdobje 2014 - 2020 Prejete obresti od sredstev iz proračuna EU iz naslova Sklada za notranjo varnost za obdobje"
  },
  {
    "code": "784315",
    "name": "2014 - 2020 Prejeta sredstva iz proračuna EU za izvajanje Programov na področju rastlin, živali, hrane in"
  },
  {
    "code": "784316",
    "name": "krme za obdobje 2014 - 2020 Prejete obresti od sredstev iz proračuna EU za izvajanje Programov na področju rastlin, živali,"
  },
  {
    "code": "784317",
    "name": "hrane in krme za obdobje 2014 - 2020 Druga prejeta sredstva iz proračuna EU iz naslova Varnost in državljanstvo za obdobje 2014 -"
  },
  {
    "code": "784318",
    "name": "2020 Prejete obresti od drugih sredstev iz proračuna EU iz naslova Varnost in državljanstvo za obdobje"
  },
  {
    "code": "784319",
    "name": "2014 - 2020"
  },
  {
    "code": "784320",
    "name": "Druga prejeta sredstva iz proračuna EU iz naslova EU globalni partner za obdobje 2014 - 2020 Prejeta sredstva iz proračuna EU iz naslova Sklada za azil, migracije in vključevanje za obdobje"
  },
  {
    "code": "784322",
    "name": "2021 - 2027"
  },
  {
    "code": "784323",
    "name": "Prejeta sredstva iz proračuna EU iz naslova Sklada za notranjo varnost za obdobje 2021 - 2027 Prejeta sredstva iz proračuna EU iz naslova Sklada za integrirano upravljanje meja za obdobje"
  },
  {
    "code": "784324",
    "name": "2021 - 2027 Prejete obresti od sredstev iz proračuna EU iz naslova Sklada za integrirano upravljanje meja za"
  },
  {
    "code": "784325",
    "name": "obdobje 2021 - 2027 Prejeta sredstva iz proračuna EU iz naslova EU obrambni sklad in preostala sredstva za varnost"
  },
  {
    "code": "784326",
    "name": "in migracije, 2021 - 2027 Prejeta sredstva iz proračuna EU iz naslova Programa za okolje in klimatske spremembe, 2021 -"
  },
  {
    "code": "784327",
    "name": "2027 Prejeta sredstva iz proračuna EU iz naslova ostalih sredstev za EU administracijo, soseščino in"
  },
  {
    "code": "784328",
    "name": "mednarodno sodelovanje, 2021 - 2027"
  },
  {
    "code": "784329",
    "name": "Sredstva EU - Programi na področju rastlin, živali, hrane in krme za obdobje 2021 - 2027"
  },
  {
    "code": "784330",
    "name": "Ostale prejete obresti EU proračuna iz naslova centraliziranih programov Prejete obresti od sredstev iz proračuna EU iz naslova Sklada za azil, migracije in vključevanje za"
  },
  {
    "code": "784331",
    "name": "obdobje 2021 - 2027 Prejete obresti od sredstev iz proračuna EU iz naslova Sklada za notranjo varnost za obdobje"
  },
  {
    "code": "784332",
    "name": "2021 - 2027"
  },
  {
    "code": "784333",
    "name": "Prejeta sredstva iz proračuna EU iz naslova Modernizacijskega sklada"
  },
  {
    "code": "786",
    "name": "OSTALA PREJETA SREDSTVA IZ PRORAČUNA EU"
  },
  {
    "code": "7860",
    "name": "Ostala prejeta sredstva iz proračuna EU"
  },
  {
    "code": "786000",
    "name": "Prejeta sredstva iz proračuna EU za povračila potnih stroškov na sestankih Sveta EU"
  },
  {
    "code": "786001",
    "name": "Prejete obresti od ostalih prejetih sredstev iz proračuna EU"
  },
  {
    "code": "786002",
    "name": "Prejeta sredstva iz proračuna EU iz naslova ukrepa Forest Focus"
  },
  {
    "code": "786018",
    "name": "Sredstva za NOO"
  },
  {
    "code": "786019",
    "name": "Sredstva EU - Sklad za prilagoditev na Brexit (BAR)"
  },
  {
    "code": "786099",
    "name": "Ostala prejeta sredstva iz proračuna EU"
  },
  {
    "code": "787",
    "name": "PREJETA SREDSTVA OD DRUGIH EVROPSKIH INSTITUCIJ IN IZ DRUGIH DRŽAV"
  },
  {
    "code": "7870",
    "name": "Prejeta sredstva od drugih evropskih institucij in iz drugih držav"
  },
  {
    "code": "787000",
    "name": "Prejeta sredstva od drugih evropskih institucij"
  },
  {
    "code": "787001",
    "name": "Prejete obresti od prejetih sredstev od drugih evropskih institucij"
  },
  {
    "code": "787002",
    "name": "Prejeta sredstva v okviru Švicarskega prispevka"
  },
  {
    "code": "787003",
    "name": "Prejeta sredstva v okviru Norveškega finančnega mehanizma in Finančnega mehanizma EGP"
  },
  {
    "code": "788",
    "name": "PREJETA VRAČILA SREDSTEV IZ PRORAČUNA EU"
  },
  {
    "code": "7880",
    "name": "Prejeta vračila sredstev iz proračuna EU"
  },
  {
    "code": "788000",
    "name": "Prejeta vračila sredstev iz proračuna EU iz naslova tradicionalnih lastnih sredstev"
  },
  {
    "code": "788001",
    "name": "Prejeta vračila sredstev iz proračuna EU iz naslova davka na dodano vrednost"
  },
  {
    "code": "788002",
    "name": "Prejeta vračila sredstev iz proračuna EU iz naslova bruto nacionalnega dohodka (BND)"
  },
  {
    "code": "788003",
    "name": "Prejeta vračila sredstev iz proračuna EU iz naslova popravka v korist Združenega kraljestva Prejeta vračila sredstev iz proračuna EU iz naslova popravkov bruto nacionalnega dohodka"
  },
  {
    "code": "788004",
    "name": "(BND) v korist drugih držav"
  },
  {
    "code": "788005",
    "name": "Prejeta vračila sredstev iz proračuna EU iz naslova nereciklirane plastične embalaže Prejeta vračila sredstev iz proračuna EU iz naslova bruto znižanja letnega prispevka iz naslova"
  },
  {
    "code": "788006",
    "name": "bruto nacionalnega dohodka (BND) v korist nekaterih držav"
  },
  {
    "code": "79",
    "name": "PRENOS PRIHODKOV IN DRUGIH PREJEMKOV"
  },
  {
    "code": "790",
    "name": "PRENOS PRIHODKOV IN DRUGIH PREJEMKOV"
  },
  {
    "code": "797",
    "name": "EVIDENČNI PROMET PRIHODKOV REŽIJSKIH OBRATOV EVIDENČNI PROMET PRIHODKOV IN DRUGIH PREJEMKOV DOLOČENIH UPORABNIKOV"
  },
  {
    "code": "799",
    "name": "ENOTNEGA KONTNEGA NAČRTA"
  },
  {
    "code": "80",
    "name": "UGOTOVITEV REZULTATA"
  },
  {
    "code": "800",
    "name": "UGOTOVITEV REZULTATA PRESEŽEK PRIHODKOV PREJŠNJIH LET NAMENJEN POKRITJU ODHODKOV TEKOČEGA"
  },
  {
    "code": "801",
    "name": "LETA PRESEŽEK ODHODKOV PREJŠNJIH LET, KI SE POKRIVA IZ PRIHODKOV TEKOČEGA"
  },
  {
    "code": "802",
    "name": "LETA"
  },
  {
    "code": "803",
    "name": "PRESEŽEK PRIHODKOV IN PRENOS"
  },
  {
    "code": "804",
    "name": "PRESEŽEK ODHODKOV IN PRENOS"
  },
  {
    "code": "805",
    "name": "DAVEK OD DOHODKOV PRAVNIH OSEB"
  },
  {
    "code": "806",
    "name": "PRESEŽEK PRIHODKOV PO OBRAČUNU DAVKA OD DOHODKOV PRAVNIH OSEB"
  },
  {
    "code": "807",
    "name": "PRESEŽEK ODHODKOV PO OBRAČUNU DAVKA OD DOHODKOV PRAVNIH OSEB"
  },
  {
    "code": "90",
    "name": "SPLOŠNI SKLAD"
  },
  {
    "code": "900",
    "name": "SPLOŠNI SKLAD"
  },
  {
    "code": "9000",
    "name": "Splošni sklad za neopredmetena sredstva in opredmetena osnovna sredstva"
  },
  {
    "code": "9001",
    "name": "Splošni sklad za finančne naložbe"
  },
  {
    "code": "9002",
    "name": "Splošni sklad za unovčena poroštva"
  },
  {
    "code": "9003",
    "name": "Splošni sklad za terjatve za sredstva dana v upravljanje"
  },
  {
    "code": "9004",
    "name": "Splošni sklad za namenska sredstva, prenesena javnim skladom Splošni sklad za sredstva, prenesena drugim pravnim osebam javnega prava, ki imajo"
  },
  {
    "code": "9005",
    "name": "premoženje v svoji lasti"
  },
  {
    "code": "9006",
    "name": "Splošni sklad za posebne namene"
  },
  {
    "code": "9009",
    "name": "Splošni sklad za drugo"
  },
  {
    "code": "91",
    "name": "REZERVNI SKLAD"
  },
  {
    "code": "910",
    "name": "REZERVNI SKLAD"
  },
  {
    "code": "911",
    "name": "REZERVACIJE ZA KREDITNA TVEGANJA V JAVNIH SKLADIH"
  },
  {
    "code": "92",
    "name": "DOLGOROČNE PASIVNE ČASOVNE RAZMEJITVE"
  },
  {
    "code": "920",
    "name": "DOLGOROČNO ODLOŽENI PRIHODKI"
  },
  {
    "code": "921",
    "name": "DOLGOROČNO NEPLAČANI PRIHODKI"
  },
  {
    "code": "922",
    "name": "PREJETE DONACIJE, NAMENJENE NADOMEŠČANJU STROŠKOV AMORTIZACIJE"
  },
  {
    "code": "93",
    "name": "REZERVACIJE"
  },
  {
    "code": "931",
    "name": "REZERVACIJE IZ NASLOVA DOLGOROČNO VNAPREJ VRAČUNANIH ODHODKOV"
  },
  {
    "code": "935",
    "name": "DRUGE REZERVACIJE SKLAD PREMOŽENJA V JAVNIH SKLADIH IN DRUGIH PRAVNIH OSEBAH JAVNEGA"
  },
  {
    "code": "94",
    "name": "PRAVA, KI JE V NJIHOVI LASTI"
  },
  {
    "code": "940",
    "name": "SKLAD NAMENSKEGA PREMOŽENJA V JAVNIH SKLADIH"
  },
  {
    "code": "9400",
    "name": "Sklad namenskega premoženja v nepremičninskih skladih"
  },
  {
    "code": "9401",
    "name": "Sklad namenskega premoženja v finančnih skladih"
  },
  {
    "code": "9402",
    "name": "Sklad namenskega premoženja v javnih skladih za unovčena poroštva"
  },
  {
    "code": "9403",
    "name": "Sklad namenskega premoženja v javnih skladih za drugo SKLAD PREMOŽENJA V DRUGIH PRAVNIH OSEBAH JAVNEGA PRAVA, KI JE V NJIHOVI"
  },
  {
    "code": "941",
    "name": "LASTI Sklad premoženja v drugih pravnih osebah javnega prava, ki je v njihovi lasti, za neopredmetena"
  },
  {
    "code": "9410",
    "name": "sredstva in opredmetena osnovna sredstva Sklad premoženja v drugih pravnih osebah javnega prava, ki je v njihovi lasti, za finančne"
  },
  {
    "code": "9411",
    "name": "naložbe"
  },
  {
    "code": "9412",
    "name": "Presežek prihodkov nad odhodki"
  },
  {
    "code": "9413",
    "name": "Presežek odhodkov nad prihodki"
  },
  {
    "code": "96",
    "name": "DOLGOROČNE FINANČNE OBVEZNOSTI"
  },
  {
    "code": "960",
    "name": "DOLGOROČNI KREDITI, PREJETI V DRŽAVI"
  },
  {
    "code": "961",
    "name": "DOLGOROČNI KREDITI, PREJETI V TUJINI"
  },
  {
    "code": "962",
    "name": "DOLGOROČNO IZDANI VREDNOSTNI PAPIRJI"
  },
  {
    "code": "963",
    "name": "DOLGOROČNE FINANČNE OBVEZNOSTI IZ NASLOVA PREVZEMA DOLGA"
  },
  {
    "code": "97",
    "name": "DRUGE DOLGOROČNE OBVEZNOSTI"
  },
  {
    "code": "970",
    "name": "DOLGOROČNE OBVEZNOSTI IZ FINANCIRANJA"
  },
  {
    "code": "971",
    "name": "DOLGOROČNE OBVEZNOSTI IZ POSLOVANJA"
  },
  {
    "code": "98",
    "name": "OBVEZNOSTI ZA SREDSTVA PREJETA V UPRAVLJANJE OBVEZNOSTI ZA NEOPREDMETENA SREDSTVA IN OPREDMETENA OSNOVNA"
  },
  {
    "code": "980",
    "name": "SREDSTVA"
  },
  {
    "code": "981",
    "name": "OBVEZNOSTI ZA DOLGOROČNE FINANČNE NALOŽBE"
  },
  {
    "code": "985",
    "name": "PRESEŽEK PRIHODKOV NAD ODHODKI"
  },
  {
    "code": "986",
    "name": "PRESEŽEK ODHODKOV NAD PRIHODKI"
  },
  {
    "code": "99",
    "name": "IZVENBILANČNA EVIDENCA"
  },
  {
    "code": "990",
    "name": "AKTIVNI KONTI IZVENBILANČNE EVIDENCE"
  },
  {
    "code": "999",
    "name": "PASIVNI KONTI IZVENBILANČNE EVIDENCE"
  }
] as const;
