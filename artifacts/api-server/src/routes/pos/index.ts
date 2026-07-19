/**
 * POS Gostinstvo — ruter za vse POS endpoint-e.
 * Vsi zahtevki zahtevajo:
 *   Authorization: Bearer <clerk-jwt>   (Clerk)
 *   X-Enota-Id: <integer>               (aktivna poslovna enota)
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { requireEnota } from "../../middlewares/pos";
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

const router: IRouter = Router();

// SSE tok za kuhinjo in blagajne — zahteva auth
router.get("/pos/events", requireEnota, (req: Request, res: Response) => {
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

// Vse POS rute — zahtevajo Clerk JWT + X-Enota-Id
router.use("/pos", requireEnota, enoteRouter);
router.use("/pos", requireEnota, kategorijeRouter);
router.use("/pos", requireEnota, artikliRouter);
router.use("/pos", requireEnota, mizeRouter);
router.use("/pos", requireEnota, prostoriRouter);
router.use("/pos", requireEnota, narocilaRouter);
router.use("/pos", requireEnota, racuniRouter);
router.use("/pos", requireEnota, nastavitveRouter);
router.use("/pos", requireEnota, natakariRouter);
router.use("/pos", requireEnota, izmeneRouter);
router.use("/pos", requireEnota, blagajneRouter);
router.use("/pos", requireEnota, poslovniProstoriRouter);
router.use("/pos", requireEnota, napraveRouter);
router.use("/pos", requireEnota, statistikeRouter);
router.use("/pos", requireEnota, certifikatRouter);
router.use("/pos", requireEnota, fursRegisterRouter);
router.use("/pos", requireEnota, fursDiagnostikaRouter);
router.use("/pos", requireEnota, kupecRouter);
router.use("/pos", requireEnota, glasovniSinonimiRouter);
router.use("/pos", requireEnota, dnevniMeniRouter);
router.use("/pos", requireEnota, modSkupineRouter);
router.use("/pos", requireEnota, inventureRouter);
router.use("/pos", requireEnota, prejemniceRouter);
router.use("/pos", requireEnota, zacetneZalogeRouter);
router.use("/pos", requireEnota, zalogeRouter);

export default router;
