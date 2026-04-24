"""
Distribution Engine — Mendistribusikan grup ke akun secara balanced.
"""
import math
import random
from typing import List, Dict


def distribute_groups(
    account_ids: List[int],
    group_ids: List[int],
    groups_per_account: int = 8,
    prevent_duplicate: bool = False
) -> Dict[int, List[int]]:
    """
    Distribusikan group_ids ke account_ids secara balanced.

    Args:
        account_ids: List ID akun aktif
        group_ids: List ID grup target
        groups_per_account: Maksimum grup per akun (default 8)
        prevent_duplicate: Jika True, satu grup hanya dikirim 1 akun

    Returns:
        Dict {account_id: [group_id, ...]}
    """
    if not account_ids or not group_ids:
        return {}

    assignment: Dict[int, List[int]] = {acc: [] for acc in account_ids}

    if prevent_duplicate:
        # Setiap grup ke tepat 1 akun (round-robin)
        shuffled_groups = list(group_ids)
        random.shuffle(shuffled_groups)

        for i, grp in enumerate(shuffled_groups):
            acc = account_ids[i % len(account_ids)]
            if len(assignment[acc]) < groups_per_account:
                assignment[acc].append(grp)
            else:
                # Cari akun lain yang masih bisa
                for other_acc in account_ids:
                    if len(assignment[other_acc]) < groups_per_account:
                        assignment[other_acc].append(grp)
                        break
    else:
        # Setiap akun dapat semua grup (setiap grup dikirim ke semua akun)
        # Tapi batasi dengan groups_per_account
        # Distribusi: kelompokkan grup, setiap akun dapat segmen berbeda
        chunk_size = math.ceil(len(group_ids) / len(account_ids))
        chunk_size = min(chunk_size, groups_per_account)

        shuffled_groups = list(group_ids)
        random.shuffle(shuffled_groups)

        for i, acc in enumerate(account_ids):
            start = i * chunk_size
            end = start + chunk_size
            assignment[acc] = shuffled_groups[start:end]

    return assignment


def balance_assignment(
    current: Dict[int, List[int]],
    max_per_account: int = 10
) -> Dict[int, List[int]]:
    """
    Rebalance jika ada akun dengan terlalu banyak atau terlalu sedikit grup.
    """
    all_groups = []
    for grps in current.values():
        all_groups.extend(grps)

    accounts = list(current.keys())
    return distribute_groups(accounts, all_groups, max_per_account, prevent_duplicate=True)


def get_optimal_groups_per_account(total_groups: int, total_accounts: int) -> int:
    """Hitung jumlah grup optimal per akun."""
    if total_accounts == 0:
        return 0
    base = math.ceil(total_groups / total_accounts)
    return max(1, min(base, 15))  # Minimal 1, maksimal 15
