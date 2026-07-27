import type { GeoStatus } from "../../enums";

export interface AreaView {
  id: string;
  name: string;
  slug: string;
  status: GeoStatus;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
