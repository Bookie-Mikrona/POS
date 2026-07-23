/**
 * POS Gostinstvo — ruter za vse POS endpoint-e.
 *
 * Generirani API klient (@workspace/api-client-react) kliče poti brez /pos/ prefiksa
 * (npr. /api/enote, /api/artikli). Rute so zato montirane direktno na koren.
 *
 * Izjema: auth ruta ostane na /pos/auth/me ker jo AuthContext kliče direktno s tem URL-om.
 *
 * Zahteve za večino rut:
 *   Authorization: Bearer <clerk-jwt>   (Clerk)
 *   X-Enota-Id: <integer>               (aktivna poslovna enota)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireEnota, requirePosCompany } from "../../middlewares/pos";
import { addClient, removeClient } from "../../lib/pos-sse";

import enoteRouter from "./enote";
import kategorijeRouter from "./kategorije";
import artikliRouter from "./artikli";
import mizeRouter from "./mize";
import prostoriRouter from "./prostori";
import narocilaRouter from "./narocila";
import racuniRouter from "./racuni";
import nastavitveRouter from "./nastavitve";
import natakariRouter from "./natakari";
import izmeneRouter from "./izmene";
import blagajneRouter from "./blagajne";
import poslovniProstoriRouter from "./poslovni-prostori";
import napraveRouter from "./naprave";
import statistikeRouter from "./statistike";
import certifikatRouter from "./certifikat";
import fursRegisterRouter from "./furs-register";
import fursDiagnostikaRouter from "./furs-diagnostika";
import kupecRouter from "./kupec";
import glasovniSinonimiRouter from "./glasovni-sinonimi";
import dnevniMeniRouter from "./dnevni-meni";
import modSkupineRouter from "./modifikatorske-skupine";
import inventureRouter from "./inventure";
import prejemniceRouter from "./prejemnice";
import zacetneZalogeRouter from "./zacetne-zaloge";
import zalogeRouter from "./zaloge";
import posAuthRouter from "./auth";
import posAdminUporabnikiRouter from "./admin-uporabniki";

const router: IRouter = Router();

// SSE tok za kuhinjo in blagajne — zahteva auth
// Klient kliče /api/events (useRealtimeSync.ts)
router.get("/events", requireEnota, (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write("event: ping\ndata: {}\n\n");

  const napravaId = typeof req.query.napravaId === "string" ? req.query.napravaId : null;
  addClient(res, napravaId);

  const keepalive = setInterval(() => {
    try { res.write("event: ping\ndata: {}\n\n"); }
    catch { clearInterval(keepalive); }
  }, 25000);

  req.on("close", () => {
    clearInterval(keepalive);
    removeClient(res);
  });
});

// Auth ruta — ostane na /pos/ ker jo AuthContext kliče direktno z /api/pos/auth/me
router.use("/pos", posAuthRouter);

// POS admin — upravljanje uporabnikov (brez X-Enota-Id)
router.use(posAdminUporabnikiRouter);

// Upravljanje enot — samo Clerk JWT + POS admin vloga (brez X-Enota-Id)
// POZOR: montirano na /enote da requirePosCompany ne blokira ostalih rut (mize, narocila...)
router.use("/enote", requirePosCompany, enoteRouter);

// Vse ostale POS rute — zahtevajo Clerk JWT + X-Enota-Id
router.use(requireEnota, kategorijeRouter);
router.use(requireEnota, artikliRouter);
router.use(requireEnota, mizeRouter);
router.use(requireEnota, prostoriRouter);
router.use(requireEnota, narocilaRouter);
router.use(requireEnota, racuniRouter);
router.use(requireEnota, nastavitveRouter);
router.use(requireEnota, natakariRouter);
router.use(requireEnota, izmeneRouter);
router.use(requireEnota, blagajneRouter);
router.use(requireEnota, poslovniProstoriRouter);
router.use(requireEnota, napraveRouter);
router.use(requireEnota, statistikeRouter);
router.use(requireEnota, certifikatRouter);
router.use(requireEnota, fursRegisterRouter);
router.use(requireEnota, fursDiagnostikaRouter);
router.use(requireEnota, kupecRouter);
router.use(requireEnota, glasovniSinonimiRouter);
router.use(requireEnota, dnevniMeniRouter);
router.use(requireEnota, modSkupineRouter);
router.use(requireEnota, inventureRouter);
router.use(requireEnota, prejemniceRouter);
router.use(requireEnota, zacetneZalogeRouter);
router.use(requireEnota, zalogeRouter);

export default router;
