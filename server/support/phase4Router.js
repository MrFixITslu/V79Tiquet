import express from "express";
import {SupportError,ensureObject,noExtraKeys,versionOf} from "./contracts.js";
import {requireIdentity,supportCapabilities,requireCapability} from "./permissions.js";
// Mounted only in the isolated localhost synthetic fixture, never production.
export function createPhase4Router({db,authenticateToken,service,resolveCapabilities=null}){
 if(!db?.query||typeof authenticateToken!=="function"||!service?.readSla)
  throw new Error("PHASE4_SYNTHETIC_DEPENDENCIES_REQUIRED");
 const router=express.Router();
 const wrap=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res,next)).catch(e=>{
  if(e instanceof SupportError)return res.status(e.status).json({code:e.code,error:e.message});
  return res.status(503).json({code:"PHASE4_UNAVAILABLE",error:"Synthetic support unavailable"});
 });
 router.use(authenticateToken);
 router.use(wrap(async(req,res,next)=>{
  res.set("Cache-Control","no-store");
  requireIdentity(req);
  const found=await db.query("SELECT role,permissions FROM users WHERE id=$1 AND account_id=$2",
   [req.user.id,req.accountId]);
  if(!found.rows[0])throw new SupportError(401,"SUPPORT_UNAUTHENTICATED");
  req.supportCaps=supportCapabilities(resolveCapabilities?await resolveCapabilities(req):found.rows[0]);
  next();
 }));
 const args=req=>({accountId:req.accountId,actorId:req.user.id,
  ticketId:req.params.ticketId,caps:req.supportCaps});
 router.get("/calendar",wrap(async(req,res)=>{
  requireCapability(req,"support.view");
  res.json(await service.policyInfo(req.accountId));
 }));
 router.get("/tickets/:ticketId/sla",wrap(async(req,res)=>{
  requireCapability(req,"support.view");
  res.json(await service.readSla(args(req)));
 }));
 router.get("/tickets/:ticketId/alerts",wrap(async(req,res)=>{
  requireCapability(req,"support.view");
  res.json({items:await service.alerts(args(req))});
 }));
 router.post("/tickets/:ticketId/automations/evaluate",wrap(async(req,res)=>{
  requireCapability(req,"support.view.all");
  res.json(await service.evaluateRules(args(req)));
 }));
 router.get("/tickets/:ticketId/presence",wrap(async(req,res)=>{
  requireCapability(req,"support.view");
  res.json(await service.presence(args(req)));
 }));
 router.put("/tickets/:ticketId/presence",wrap(async(req,res)=>{
  requireCapability(req,"support.view");
  const body=ensureObject(req.body);
  noExtraKeys(body,["mode"]);
  const version=versionOf(req.headers["if-match"]);
  res.json(await service.heartbeat({...args(req),mode:body.mode,version}));
 }));
 return router;
}
