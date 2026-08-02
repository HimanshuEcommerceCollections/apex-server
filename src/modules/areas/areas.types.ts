import type { GeoStatus } from "../../enums";

export interface AreaView {
  id: string;
  name: string;
  slug: string;
  duration: string | null;
  status: GeoStatus;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
