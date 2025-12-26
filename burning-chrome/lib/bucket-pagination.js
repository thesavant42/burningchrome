// Bucket Pagination Controls

/**
 * Render pagination controls into a container
 * @param {string} containerId - DOM element ID
 * @param {object} state - { currentPage, totalPages, filteredCount, rowsPerPage }
 * @param {function} onPageChange - Callback when page changes
 */
export function renderPaginationControls(containerId, state, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  container.innerHTML = '';
  
  const { currentPage, totalPages, filteredCount, rowsPerPage } = state;
  
  if (totalPages <= 1) return;
  
  // First button
  const firstBtn = document.createElement('button');
  firstBtn.textContent = '<<';
  firstBtn.title = 'First page';
  firstBtn.disabled = currentPage === 1;
  firstBtn.onclick = () => onPageChange(1);
  container.appendChild(firstBtn);
  
  // Prev button
  const prevBtn = document.createElement('button');
  prevBtn.textContent = '<';
  prevBtn.title = 'Previous page';
  prevBtn.disabled = currentPage === 1;
  prevBtn.onclick = () => onPageChange(currentPage - 1);
  container.appendChild(prevBtn);
  
  // Page info
  const pageInfo = document.createElement('span');
  pageInfo.className = 'page-info';
  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
  container.appendChild(pageInfo);
  
  // Jump input
  const jumpInput = document.createElement('input');
  jumpInput.type = 'number';
  jumpInput.className = 'page-jump';
  jumpInput.min = 1;
  jumpInput.max = totalPages;
  jumpInput.placeholder = '#';
  jumpInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
      const page = parseInt(jumpInput.value, 10);
      if (!isNaN(page)) {
        onPageChange(page);
        jumpInput.value = '';
      }
    }
  };
  container.appendChild(jumpInput);
  
  // Go button
  const goBtn = document.createElement('button');
  goBtn.textContent = 'Go';
  goBtn.onclick = () => {
    const page = parseInt(jumpInput.value, 10);
    if (!isNaN(page)) {
      onPageChange(page);
      jumpInput.value = '';
    }
  };
  container.appendChild(goBtn);
  
  // Next button
  const nextBtn = document.createElement('button');
  nextBtn.textContent = '>';
  nextBtn.title = 'Next page';
  nextBtn.disabled = currentPage === totalPages;
  nextBtn.onclick = () => onPageChange(currentPage + 1);
  container.appendChild(nextBtn);
  
  // Last button
  const lastBtn = document.createElement('button');
  lastBtn.textContent = '>>';
  lastBtn.title = 'Last page';
  lastBtn.disabled = currentPage === totalPages;
  lastBtn.onclick = () => onPageChange(totalPages);
  container.appendChild(lastBtn);
  
  // Range info
  const start = (currentPage - 1) * rowsPerPage + 1;
  const end = Math.min(currentPage * rowsPerPage, filteredCount);
  const rangeInfo = document.createElement('span');
  rangeInfo.className = 'range-info';
  rangeInfo.textContent = `(${start}-${end} of ${filteredCount})`;
  container.appendChild(rangeInfo);
}

