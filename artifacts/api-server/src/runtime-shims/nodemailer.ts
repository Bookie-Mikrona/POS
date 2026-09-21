import type Nodemailer from "nodemailer";
import { requireRuntimePackage } from "./runtime-require";

const nodemailer = requireRuntimePackage("nodemailer") as typeof Nodemailer;

export default nodemailer;