import type { GeoStatus } from "../../enums";

export interface ZipCodeView {
  id: string;
  areaId: string;
  area: { id: string; name: string; slug: string } | null;
  zipCode: string;
  city: string | null;
  state: string | null;
  status: GeoStatus;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
