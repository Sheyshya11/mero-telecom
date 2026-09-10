import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { InternalRequestLevel, InternalRequestStatus, Role, SupportStatus } from '@prisma/client';

import type { AuthenticatedUser } from '../../modules/auth/auth.types';

export interface InternalRequestPolicyRecord {
  requestedByUserId: string;
  assignedToUserId: string | null;
  superAdminAssignedToUserId: string | null;
  assignedToAvailable?: boolean;
  superAdminAssignedToAvailable?: boolean;
  currentLevel: InternalRequestLevel;
  status: InternalRequestStatus;
}

export interface SupportCasePolicyRecord {
  assignedToUserId: string | null;
  assignedToAvailable?: boolean;
  status: SupportStatus;
}

export interface BlockingInternalRequest {
  requestNumber: string;
  currentLevel: InternalRequestLevel;
  status: InternalRequestStatus;
}

export interface InternalRequestCapabilities {
  canTake: boolean;
  canStartReview: boolean;
  canRequestInfo: boolean;
  canApprove: boolean;
  canReject: boolean;
  canEscalate: boolean;
  canReturnToAdmin: boolean;
  canResolve: boolean;
  canClose: boolean;
  canComment: boolean;
  unavailableReason: string | null;
}

export interface SupportCaseCapabilities {
  canTake: boolean;
  canResolve: boolean;
  canClose: boolean;
  canReopen: boolean;
  canSetWaitingForCustomer: boolean;
  canChangePriority: boolean;
  canReply: boolean;
  resolutionBlockedReason: string | null;
}

@Injectable()
export class TicketWorkflowPolicyService {
  internalRequestCapabilities(
    request: InternalRequestPolicyRecord,
    actor: AuthenticatedUser,
  ): InternalRequestCapabilities {
    const isStaff = actor.role === Role.STAFF && request.requestedByUserId === actor.id;
    const isAdmin = actor.role === Role.ADMIN;
    const isSuperAdmin = actor.role === Role.SUPER_ADMIN;
    const adminOwns = isAdmin && request.assignedToUserId === actor.id;
    const superAdminOwns = isSuperAdmin && request.superAdminAssignedToUserId === actor.id;
    const atAdmin = request.currentLevel === InternalRequestLevel.ADMIN;
    const atSuperAdmin = request.currentLevel === InternalRequestLevel.SUPER_ADMIN;
    const open = !(
      [InternalRequestStatus.RESOLVED, InternalRequestStatus.CLOSED] as InternalRequestStatus[]
    ).includes(request.status);
    const canDecideAdmin =
      adminOwns &&
      atAdmin &&
      request.status === InternalRequestStatus.IN_REVIEW &&
      request.requestedByUserId !== actor.id;
    const canDecideSuperAdmin =
      superAdminOwns &&
      atSuperAdmin &&
      request.status === InternalRequestStatus.IN_REVIEW &&
      request.requestedByUserId !== actor.id;

    return {
      canTake:
        request.status === InternalRequestStatus.PENDING &&
        ((isAdmin &&
          atAdmin &&
          (!request.assignedToUserId || request.assignedToAvailable === false)) ||
          (isSuperAdmin &&
            atSuperAdmin &&
            (!request.superAdminAssignedToUserId ||
              request.superAdminAssignedToAvailable === false))),
      canStartReview:
        request.status === InternalRequestStatus.PENDING &&
        ((adminOwns && atAdmin) || (superAdminOwns && atSuperAdmin)),
      canRequestInfo: canDecideAdmin || canDecideSuperAdmin,
      canApprove: canDecideAdmin || canDecideSuperAdmin,
      canReject: canDecideAdmin || canDecideSuperAdmin,
      canEscalate: canDecideAdmin,
      canReturnToAdmin:
        superAdminOwns &&
        atSuperAdmin &&
        (
          [
            InternalRequestStatus.IN_REVIEW,
            InternalRequestStatus.MORE_INFO_REQUIRED,
            InternalRequestStatus.APPROVED,
            InternalRequestStatus.REJECTED,
          ] as InternalRequestStatus[]
        ).includes(request.status),
      canResolve:
        adminOwns &&
        atAdmin &&
        request.status === InternalRequestStatus.APPROVED &&
        request.requestedByUserId !== actor.id,
      canClose:
        adminOwns &&
        atAdmin &&
        (
          [
            InternalRequestStatus.REJECTED,
            InternalRequestStatus.RESOLVED,
          ] as InternalRequestStatus[]
        ).includes(request.status),
      canComment: open && (isStaff || adminOwns || (superAdminOwns && atSuperAdmin)),
      unavailableReason: this.internalRequestUnavailableReason(request, actor),
    };
  }

  assertAdminActor(actor: AuthenticatedUser): void {
    if (actor.role !== Role.ADMIN) {
      throw new ForbiddenException('Only an Administrator can perform this review action.');
    }
  }

  assertSuperAdminActor(actor: AuthenticatedUser): void {
    if (actor.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only a Super Administrator can perform this review action.');
    }
  }

  assertNotSelfDecision(
    request: Pick<InternalRequestPolicyRecord, 'requestedByUserId'>,
    actor: AuthenticatedUser,
  ): void {
    if (request.requestedByUserId === actor.id) {
      throw new ForbiddenException('You cannot review or approve your own internal request.');
    }
  }

  supportCaseCapabilities(
    supportCase: SupportCasePolicyRecord,
    actor: AuthenticatedUser,
    blockers: readonly BlockingInternalRequest[],
  ): SupportCaseCapabilities {
    const assignedMine = supportCase.assignedToUserId === actor.id;
    const active = !([SupportStatus.RESOLVED, SupportStatus.CLOSED] as SupportStatus[]).includes(
      supportCase.status,
    );
    const resolutionBlockedReason = this.resolutionBlockedReason(blockers);
    return {
      canTake:
        supportCase.status !== SupportStatus.CLOSED &&
        (!supportCase.assignedToUserId || supportCase.assignedToAvailable === false),
      canResolve: assignedMine && active && !resolutionBlockedReason,
      canClose:
        assignedMine && supportCase.status === SupportStatus.RESOLVED && !resolutionBlockedReason,
      canReopen: assignedMine && supportCase.status === SupportStatus.RESOLVED,
      canSetWaitingForCustomer: assignedMine && supportCase.status === SupportStatus.IN_PROGRESS,
      canChangePriority: assignedMine && supportCase.status !== SupportStatus.CLOSED,
      canReply: supportCase.status !== SupportStatus.CLOSED,
      resolutionBlockedReason,
    };
  }

  assertSupportOwner(supportCase: SupportCasePolicyRecord, actor: AuthenticatedUser): void {
    if (!supportCase.assignedToUserId) {
      throw new ConflictException('Take this support request before changing its workflow.');
    }
    if (supportCase.assignedToUserId !== actor.id) {
      throw new ForbiddenException('Only the assigned owner can change this support request.');
    }
  }

  assertCanLinkSupportCustomer(
    supportCase: SupportCasePolicyRecord,
    actor: AuthenticatedUser,
  ): void {
    if (supportCase.status === SupportStatus.CLOSED) {
      throw new ConflictException('A closed enquiry cannot be linked to a customer.');
    }
    if (actor.role === Role.STAFF) {
      this.assertSupportOwner(supportCase, actor);
      return;
    }
    if (actor.role !== Role.ADMIN && actor.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('You cannot link this enquiry to a customer.');
    }
  }

  assertCanResolveSupport(
    supportCase: SupportCasePolicyRecord,
    actor: AuthenticatedUser,
    blockers: readonly BlockingInternalRequest[],
  ): void {
    this.assertSupportOwner(supportCase, actor);
    const reason = this.resolutionBlockedReason(blockers);
    if (reason) throw new ConflictException(reason);
    if (
      !(
        [
          SupportStatus.OPEN,
          SupportStatus.IN_PROGRESS,
          SupportStatus.WAITING_FOR_CUSTOMER,
        ] as SupportStatus[]
      ).includes(supportCase.status)
    ) {
      throw new ConflictException(
        'This support request cannot be resolved from its current state.',
      );
    }
  }

  assertCanCloseSupport(
    supportCase: SupportCasePolicyRecord,
    actor: AuthenticatedUser,
    blockers: readonly BlockingInternalRequest[],
  ): void {
    this.assertSupportOwner(supportCase, actor);
    const reason = this.resolutionBlockedReason(blockers);
    if (reason) throw new ConflictException(reason);
    if (supportCase.status !== SupportStatus.RESOLVED) {
      throw new ConflictException('Only a resolved support request can be closed.');
    }
  }

  private resolutionBlockedReason(blockers: readonly BlockingInternalRequest[]): string | null {
    const blocker = blockers[0];
    if (!blocker) return null;
    if (blocker.currentLevel === InternalRequestLevel.SUPER_ADMIN) {
      if (blocker.status === InternalRequestStatus.MORE_INFO_REQUIRED) {
        return `Ticket cannot be resolved while Super Admin is waiting for information on ${blocker.requestNumber}.`;
      }
      if (blocker.status === InternalRequestStatus.APPROVED) {
        return `Ticket cannot be resolved until the approved action for ${blocker.requestNumber} is completed and recorded.`;
      }
      return `Ticket cannot be resolved while a Super Admin escalation is awaiting a decision (${blocker.requestNumber}).`;
    }
    if (blocker.status === InternalRequestStatus.APPROVED) {
      return `Ticket cannot be resolved until the approved action for ${blocker.requestNumber} is completed and recorded.`;
    }
    if (blocker.status === InternalRequestStatus.MORE_INFO_REQUIRED) {
      return `Ticket cannot be resolved while ${blocker.requestNumber} requires more information.`;
    }
    return `Ticket cannot be resolved while internal request ${blocker.requestNumber} is unfinished.`;
  }

  private internalRequestUnavailableReason(
    request: InternalRequestPolicyRecord,
    actor: AuthenticatedUser,
  ): string | null {
    if (request.status === InternalRequestStatus.CLOSED) return 'This request is closed.';
    if (request.currentLevel === InternalRequestLevel.SUPER_ADMIN && actor.role === Role.ADMIN) {
      return 'This request is currently being reviewed by Super Admin.';
    }
    if (request.currentLevel === InternalRequestLevel.ADMIN && actor.role === Role.SUPER_ADMIN) {
      return 'This request is currently with Admin.';
    }
    if (request.status === InternalRequestStatus.MORE_INFO_REQUIRED) {
      return 'More information is required before review can continue.';
    }
    if (request.status === InternalRequestStatus.APPROVED) {
      return 'Approval is recorded; the authorised work must be completed before resolution.';
    }
    return null;
  }
}
