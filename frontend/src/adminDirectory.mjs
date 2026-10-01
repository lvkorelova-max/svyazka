export function countActiveApplications(applications) {
  return applications.filter((application) => application.status === "PENDING").length;
}

export function getAdminCreatorStatus(creator) {
  if (creator?.user?.status === "BLOCKED") {
    return { label: "Заблокирован", type: "danger" };
  }
  return { label: "Активен", type: "success" };
}

export function getAdminApplicationStatus(application) {
  if (
    application?.status === "PENDING" &&
    application?.termsStatus === "REACCEPTANCE_REQUIRED"
  ) {
    return { label: "Нужно согласие креатора", type: "danger" };
  }

  const statuses = {
    PENDING: { label: "На рассмотрении", type: "pending" },
    APPROVED: { label: "Одобрена", type: "success" },
    REJECTED: { label: "Отклонена", type: "danger" },
    CANCELLED: { label: "Отменена", type: "danger" },
    WITHDRAWN: { label: "Отозвана", type: "danger" }
  };

  return statuses[application?.status] || {
    label: application?.status || "Неизвестно",
    type: "pending"
  };
}
