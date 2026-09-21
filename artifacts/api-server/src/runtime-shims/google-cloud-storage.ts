import type * as GoogleCloudStorage from "@google-cloud/storage";
import { requireRuntimePackage } from "./runtime-require";

const googleCloudStorage = requireRuntimePackage("@google-cloud/storage") as typeof GoogleCloudStorage;

export const Storage = googleCloudStorage.Storage;