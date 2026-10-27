import { SignFlowStatus } from '@prisma/client';
import { mapEsignStatus, nextStatus } from '../src/esign/esign-status';

describe('esign status mapping', () => {
  it('maps e-sign flow status codes', () => {
    expect(mapEsignStatus(1)).toBe(SignFlowStatus.PENDING);
    expect(mapEsignStatus(2)).toBe(SignFlowStatus.SIGNED);
    expect(mapEsignStatus(3)).toBe(SignFlowStatus.CANCELED);
    expect(mapEsignStatus(5)).toBe(SignFlowStatus.EXPIRED);
    expect(mapEsignStatus(7)).toBe(SignFlowStatus.REJECTED);
    expect(mapEsignStatus(42)).toBeNull();
  });

  it('never moves a finished flow and ignores unknown or draft codes', () => {
    expect(nextStatus(SignFlowStatus.PENDING, SignFlowStatus.SIGNED)).toBe(SignFlowStatus.SIGNED);
    expect(nextStatus(SignFlowStatus.SIGNED, SignFlowStatus.CANCELED)).toBe(SignFlowStatus.SIGNED);
    expect(nextStatus(SignFlowStatus.CANCELED, SignFlowStatus.PENDING)).toBe(SignFlowStatus.CANCELED);
    expect(nextStatus(SignFlowStatus.PENDING, null)).toBe(SignFlowStatus.PENDING);
    expect(nextStatus(SignFlowStatus.PENDING, SignFlowStatus.DRAFT)).toBe(SignFlowStatus.PENDING);
  });
});
