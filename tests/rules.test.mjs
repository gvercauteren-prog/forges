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
await t("main removes bob's admin", assertSucceeds(updateDoc(doc(main,"members","bob@gmail.com"),{admin:false})));

console.log(`\n${pass} passed, ${failc} failed`);
await env.cleanup();
process.exit(failc?1:0);
