import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { AssetCertified } from '@sp/shared';

/** Evento certificato, con i giocatori coinvolti: il gateway (M1) lo inoltra come `asset.certified`. */
export interface CertifiedNotice extends AssetCertified {
  fromId: number | null;
  toId: number;
}

@Injectable()
export class ChainEventsService {
  private readonly certified = new Subject<CertifiedNotice[]>();
  readonly certified$: Observable<CertifiedNotice[]> = this.certified.asObservable();

  publish(batch: CertifiedNotice[]): void {
    if (batch.length) this.certified.next(batch);
  }
}
