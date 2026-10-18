import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, updateDoc, deleteDoc, getDocs, collection } from "firebase/firestore";
import fs from "node:fs";

const env = await initializeTestEnvironment({
  projectId: "forge-jean-petit",
  firestore: { rules: fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8080 },
});
const as = (uid, email) => env.authenticatedContext(uid, { email, email_verified: true }).firestore();
const main = as("uMain", "gvercauteren@gmail.com");
const anna = as("uAnna", "anna@gmail.com");   // family f2, plain member
const bob  = as("uBob",  "bob@gmail.com");    // family f3, co-admin
const eve  = as("uEve",  "eve@gmail.com");    // not invited
const anon = env.unauthenticatedContext().firestore();

const booking = (uid, email, family, extra={}) => ({ uid, email, name:"x", family, start:"2026-11-01", end:"2026-11-05", note:"", checklist:{}, createdAt:"t", updatedAt:"t", ...extra });
let pass=0, failc=0;
async function t(name, p){ try{ await p; pass++; console.log("ok   ", name); }catch(e){ failc++; console.log("FAIL ", name, e.message?.slice(0,120)); } }

await t("main admin seeds settings", assertSucceeds(setDoc(doc(main,"config","settings"),{families:[],checklist:[],contacts:[]})));
await t("main admin adds own member doc", assertSucceeds(setDoc(doc(main,"members","gvercauteren@gmail.com"),{family:"f1",admin:true})));
await t("main admin adds anna", assertSucceeds(setDoc(doc(main,"members","anna@gmail.com"),{family:"f2",admin:false})));
await t("main admin makes bob admin", assertSucceeds(setDoc(doc(main,"members","bob@gmail.com"),{family:"f3",admin:true})));

await t("not invited: cannot read bookings", assertFails(getDocs(collection(eve,"bookings"))));
await t("not invited: can check own invite doc", assertSucceeds(getDoc(doc(eve,"members","eve@gmail.com"))));
await t("not invited: cannot add self", assertFails(setDoc(doc(eve,"members","eve@gmail.com"),{family:"f1",admin:false})));
await t("signed out: cannot read", assertFails(getDocs(collection(anon,"bookings"))));

await t("anna books for own family", assertSucceeds(setDoc(doc(anna,"bookings","b1"), booking("uAnna","anna@gmail.com","f2"))));
await t("anna cannot book for another family", assertFails(setDoc(doc(anna,"bookings","b2"), booking("uAnna","anna@gmail.com","f5"))));
await t("anna cannot book as someone else", assertFails(setDoc(doc(anna,"bookings","b3"), booking("uBob","bob@gmail.com","f2"))));
await t("bad dates rejected", assertFails(setDoc(doc(anna,"bookings","b4"), booking("uAnna","anna@gmail.com","f2",{start:"2026-11-09",end:"2026-11-02"}))));
await t("main books", assertSucceeds(setDoc(doc(main,"bookings","m1"), booking("uMain","gvercauteren@gmail.com","f1"))));
await t("anna sees all bookings", assertSucceeds(getDocs(collection(anna,"bookings"))));
await t("anna edits own booking", assertSucceeds(updateDoc(doc(anna,"bookings","b1"),{note:"hi",checklist:{c01:true}})));
await t("anna cannot edit main's booking", assertFails(updateDoc(doc(anna,"bookings","m1"),{note:"hack"})));
await t("anna cannot delete main's booking", assertFails(deleteDoc(doc(anna,"bookings","m1"))));
await t("anna cannot edit settings", assertFails(setDoc(doc(anna,"config","settings"),{families:[]})));
await t("anna cannot add people", assertFails(setDoc(doc(anna,"members","x@gmail.com"),{family:"f2",admin:false})));
await t("anna cannot make herself admin", assertFails(updateDoc(doc(anna,"members","anna@gmail.com"),{admin:true})));

await t("bob (admin) edits settings", assertSucceeds(setDoc(doc(bob,"config","settings"),{families:[],checklist:[],contacts:[]})));
await t("bob adds a person", assertSucceeds(setDoc(doc(bob,"members","carl@gmail.com"),{family:"f4",admin:false})));
await t("bob cannot make someone admin", assertFails(setDoc(doc(bob,"members","dan@gmail.com"),{family:"f4",admin:true})));
await t("bob cannot promote anna", assertFails(updateDoc(doc(bob,"members","anna@gmail.com"),{admin:true})));
await t("bob cannot remove main admin", assertFails(deleteDoc(doc(bob,"members","gvercauteren@gmail.com"))));
await t("bob cannot edit anna's booking", assertFails(updateDoc(doc(bob,"bookings","b1"),{note:"x"})));
await t("admin bob books for anna's family", assertSucceeds(setDoc(doc(bob,"bookings","fam1"), booking("uBob","bob@gmail.com","f2"))));
await t("anna ticks checklist on her family's stay", assertSucceeds(updateDoc(doc(anna,"bookings","fam1"),{checklist:{c01:true}})));
await t("anna cannot change dates of that stay", assertFails(updateDoc(doc(anna,"bookings","fam1"),{end:"2026-11-09"})));
await t("main cannot tick checklist of another family", assertFails(updateDoc(doc(main,"bookings","fam1"),{checklist:{c02:true}})));
await t("not invited cannot tick checklist", assertFails(updateDoc(doc(eve,"bookings","fam1"),{checklist:{}})));
await t("bob deletes anna's booking", assertSucceeds(deleteDoc(doc(bob,"bookings","b1"))));
await t("main deletes any booking", assertSucceeds(deleteDoc(doc(main,"bookings","m1"))));

const tip = (uid, email, extra={}) => ({ uid, email, name:"x", title:"Boulangerie", category:"shop", address:"Rue 1", url:"", note:"", createdAt:"t", updatedAt:"t", ...extra });
await t("anna adds a tip", assertSucceeds(setDoc(doc(anna,"tips","t1"), tip("uAnna","anna@gmail.com"))));
await t("anna cannot add a tip as someone else", assertFails(setDoc(doc(anna,"tips","t2"), tip("uBob","bob@gmail.com"))));
await t("sport tip allowed", assertSucceeds(setDoc(doc(anna,"tips","s1"), tip("uAnna","anna@gmail.com",{category:"sport"}))));
await t("bad tip category rejected", assertFails(setDoc(doc(anna,"tips","t3"), tip("uAnna","anna@gmail.com",{category:"spam"}))));
await t("empty tip title rejected", assertFails(setDoc(doc(anna,"tips","t4"), tip("uAnna","anna@gmail.com",{title:""}))));
await t("not invited: cannot read tips", assertFails(getDocs(collection(eve,"tips"))));
await t("not invited: cannot add tip", assertFails(setDoc(doc(eve,"tips","t5"), tip("uEve","eve@gmail.com"))));
await t("main sees tips", assertSucceeds(getDocs(collection(main,"tips"))));
await t("anna edits own tip", assertSucceeds(updateDoc(doc(anna,"tips","t1"),{note:"top"})));
await t("main cannot edit anna's tip", assertFails(updateDoc(doc(main,"tips","t1"),{note:"x"})));
await t("main adds a tip", assertSucceeds(setDoc(doc(main,"tips","m1"), tip("uMain","gvercauteren@gmail.com"))));
await t("anna cannot delete main's tip", assertFails(deleteDoc(doc(anna,"tips","m1"))));
await t("admin deletes anna's tip", assertSucceeds(deleteDoc(doc(bob,"tips","t1"))));

// Carnet and house info
const note = (uid, email, extra={}) => ({ uid, email, name:"x", text:"Fuite sous l'évier", kind:"issue", resolved:false, createdAt:"t", ...extra });
await t("anna posts a note", assertSucceeds(setDoc(doc(anna,"notes","n1"), note("uAnna","anna@gmail.com"))));
await t("note posted as someone else rejected", assertFails(setDoc(doc(anna,"notes","n2"), note("uBob","bob@gmail.com"))));
await t("note posted already fixed rejected", assertFails(setDoc(doc(anna,"notes","n3"), note("uAnna","anna@gmail.com",{resolved:true}))));
await t("bad note kind rejected", assertFails(setDoc(doc(anna,"notes","n4"), note("uAnna","anna@gmail.com",{kind:"spam"}))));
await t("not invited: cannot read notes", assertFails(getDocs(collection(eve,"notes"))));
await t("main marks anna's problem fixed", assertSucceeds(updateDoc(doc(main,"notes","n1"),{resolved:true,resolvedBy:"gvercauteren@gmail.com",resolvedAt:"t"})));
await t("main cannot rewrite anna's note", assertFails(updateDoc(doc(main,"notes","n1"),{text:"changed"})));
await t("anna edits her note text", assertSucceeds(updateDoc(doc(anna,"notes","n1"),{text:"Fuite réparée"})));
await t("main posts a note", assertSucceeds(setDoc(doc(main,"notes","m1"), note("uMain","gvercauteren@gmail.com",{kind:"note"}))));
await t("anna cannot delete main's note", assertFails(deleteDoc(doc(anna,"notes","m1"))));
await t("admin deletes anna's note", assertSucceeds(deleteDoc(doc(bob,"notes","n1"))));

const supply = (uid, email, extra={}) => ({ uid, email, name:"x", text:"Bois", done:false, doneBy:"", createdAt:"t", ...extra });
await t("anna adds a supply", assertSucceeds(setDoc(doc(anna,"supplies","s1"), supply("uAnna","anna@gmail.com"))));
await t("supply as someone else rejected", assertFails(setDoc(doc(anna,"supplies","s2"), supply("uBob","bob@gmail.com"))));
await t("main ticks anna's supply", assertSucceeds(updateDoc(doc(main,"supplies","s1"),{done:true,doneBy:"gvercauteren@gmail.com"})));
await t("main cannot rename anna's supply", assertFails(updateDoc(doc(main,"supplies","s1"),{text:"Autre"})));
await t("not invited: cannot add supply", assertFails(setDoc(doc(eve,"supplies","s3"), supply("uEve","eve@gmail.com"))));
await t("member clears a bought supply", assertSucceeds(deleteDoc(doc(main,"supplies","s1"))));

await t("main writes house info", assertSucceeds(setDoc(doc(main,"config","info"),{sections:[{id:"a",title:"Wi-Fi",text:"x"}]})));
await t("anna reads house info", assertSucceeds(getDoc(doc(anna,"config","info"))));
await t("anna cannot edit house info", assertFails(setDoc(doc(anna,"config","info"),{sections:[]})));
await t("not invited: cannot read house info", assertFails(getDoc(doc(eve,"config","info"))));

// ---------- attack scenarios (pentest) ----------
const unverified = (uid, email) => env.authenticatedContext(uid, { email, email_verified: false }).firestore();
const fakeMain = unverified("uFake", "gvercauteren@gmail.com");
const annaUnv  = unverified("uAnna2", "anna@gmail.com");
await t("ATTACK unverified main-admin email cannot read", assertFails(getDocs(collection(fakeMain,"bookings"))));
await t("ATTACK unverified main-admin email cannot write settings", assertFails(setDoc(doc(fakeMain,"config","settings"),{families:[]})));
await t("ATTACK unverified main-admin email cannot add members", assertFails(setDoc(doc(fakeMain,"members","evil@gmail.com"),{family:"f1",admin:true})));
await t("ATTACK unverified invited email cannot read", assertFails(getDocs(collection(annaUnv,"bookings"))));
await t("ATTACK no-email account cannot read", assertFails(getDocs(collection(env.authenticatedContext("uNoMail",{}).firestore(),"bookings"))));

await t("setup: main books m2", assertSucceeds(setDoc(doc(main,"bookings","m2"), booking("uMain","gvercauteren@gmail.com","f1"))));
await t("setup: anna books a2", assertSucceeds(setDoc(doc(anna,"bookings","a2"), booking("uAnna","anna@gmail.com","f2"))));
await t("setup: bob (admin) books for anna's family", assertSucceeds(setDoc(doc(bob,"bookings","f2b"), booking("uBob","bob@gmail.com","f2"))));
await t("ATTACK anna takes over main's booking", assertFails(updateDoc(doc(anna,"bookings","m2"),{uid:"uAnna",email:"anna@gmail.com"})));
await t("ATTACK anna overwrites main's booking with setDoc", assertFails(setDoc(doc(anna,"bookings","m2"), booking("uAnna","anna@gmail.com","f2"))));
await t("ATTACK anna moves her booking to another family", assertFails(updateDoc(doc(anna,"bookings","a2"),{family:"f5"})));
await t("ATTACK anna rewrites owner of her booking", assertFails(updateDoc(doc(anna,"bookings","a2"),{uid:"uBob"})));
await t("ATTACK extra field on booking", assertFails(updateDoc(doc(anna,"bookings","a2"),{admin:true})));
await t("ATTACK oversized booking note", assertFails(updateDoc(doc(anna,"bookings","a2"),{note:"x".repeat(501)})));
await t("ATTACK oversized booking name", assertFails(updateDoc(doc(anna,"bookings","a2"),{name:"x".repeat(101)})));
await t("ATTACK malformed booking dates", assertFails(setDoc(doc(anna,"bookings","a3"), booking("uAnna","anna@gmail.com","f2",{start:"aaaaaaaaaa",end:"zzzzzzzzzz"}))));
await t("ATTACK booking far in the future", assertFails(setDoc(doc(anna,"bookings","a4"), booking("uAnna","anna@gmail.com","f2",{start:"2026-01-01",end:"2999-12-31"}))));
await t("ATTACK guests as text", assertFails(updateDoc(doc(anna,"bookings","a2"),{guests:"many"})));
await t("family ticks checklist on family booking", assertSucceeds(updateDoc(doc(anna,"bookings","f2b"),{checklist:{c01:true},updatedAt:"t2"})));
await t("ATTACK family changes dates via checklist path", assertFails(updateDoc(doc(anna,"bookings","f2b"),{checklist:{c01:true},start:"2026-11-02"})));
await t("ATTACK other family ticks checklist", assertFails(updateDoc(doc(anna,"bookings","m2"),{checklist:{c01:true}})));
await t("ATTACK anna deletes another family's booking", assertFails(deleteDoc(doc(anna,"bookings","f2b"))));

await t("ATTACK anna changes her own family", assertFails(updateDoc(doc(anna,"members","anna@gmail.com"),{family:"f1"})));
await t("ATTACK anna deletes a member", assertFails(deleteDoc(doc(anna,"members","bob@gmail.com"))));
await t("ATTACK not invited lists members", assertFails(getDocs(collection(eve,"members"))));
await t("ATTACK not invited reads someone's invite", assertFails(getDoc(doc(eve,"members","anna@gmail.com"))));
await t("ATTACK co-admin demotes main admin", assertFails(updateDoc(doc(bob,"members","gvercauteren@gmail.com"),{admin:false})));
await t("ATTACK co-admin deletes main admin", assertFails(deleteDoc(doc(bob,"members","gvercauteren@gmail.com"))));
await t("ATTACK co-admin adds member without admin flag", assertFails(setDoc(doc(bob,"members","sneaky@gmail.com"),{family:"f1"})));
await t("ATTACK anna hides the backup reminder", assertFails(updateDoc(doc(anna,"config","settings"),{lastBackupAt:"2099-01-01"})));
await t("ATTACK anna writes a new config doc", assertFails(setDoc(doc(anna,"config","evil"),{x:1})));
await t("ATTACK not invited reads settings", assertFails(getDoc(doc(eve,"config","settings"))));

await t("setup: main posts a note", assertSucceeds(setDoc(doc(main,"notes","mn"),{uid:"uMain",email:"gvercauteren@gmail.com",name:"G",text:"Robinet",kind:"issue",resolved:false,createdAt:"t"})));
await t("ATTACK anna rewrites main's note while resolving", assertFails(updateDoc(doc(anna,"notes","mn"),{resolved:true,text:"hacked"})));
await t("ATTACK anna deletes main's note", assertFails(deleteDoc(doc(anna,"notes","mn"))));
await t("ATTACK note posted as someone else", assertFails(setDoc(doc(anna,"notes","n9"),{uid:"uMain",email:"gvercauteren@gmail.com",name:"G",text:"x",kind:"note",resolved:false,createdAt:"t"})));
await t("ATTACK oversized note name", assertFails(setDoc(doc(anna,"notes","n10"),{uid:"uAnna",email:"anna@gmail.com",name:"x".repeat(101),text:"x",kind:"note",resolved:false,createdAt:"t"})));
await t("ATTACK anna steals main's tip", assertFails(updateDoc(doc(anna,"tips","m1"),{uid:"uAnna",email:"anna@gmail.com"})));
await t("ATTACK tip with javascript link stored as non-string", assertFails(setDoc(doc(anna,"tips","t9"), tip("uAnna","anna@gmail.com",{url:{x:1}}))));

await t("main removes bob's admin", assertSucceeds(updateDoc(doc(main,"members","bob@gmail.com"),{admin:false})));

console.log(`\n${pass} passed, ${failc} failed`);
await env.cleanup();
process.exit(failc?1:0);
