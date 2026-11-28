# Operating system file caching

When an application reads a file, the operating system can keep recently read
file data in memory. A later read may be served from that memory instead of
requiring another physical storage read. This is commonly called the **page
cache** or **file cache**. It is managed by the operating system and filesystem,
not by NaviFS.

## What gets cached

The page cache holds file contents in memory in page-sized units. On a
first-time or “cold” read, the OS may need to fetch data from storage. As the
read completes, it can retain those pages; a later “warm” read of the same
data may be much faster if the pages are still resident.

Operating systems also cache filesystem metadata, such as information used to
find files and directories. On Linux, for example, the page cache holds file
data while dentries and inode-related structures help cache filesystem
lookups. These are related performance mechanisms, but a metadata cache is not
the same thing as cached file contents. Names and implementation details vary
between operating systems and filesystems.

Cached pages are generally available to other processes on the same host that
read the same file. They are not a cache shared with NaviFS clients over HTTP.

## Writes: write-through and write-back

With **write-through** behavior, a write is passed through to storage before
the operation is treated as complete. With **write-back** behavior, changed
data can first be held in memory as “dirty” pages and written to storage later.
Operating systems and storage devices use different policies, and may combine
these strategies.

An application-level write completing does not necessarily mean every byte is
durably stored on physical media. Applications that require durability across
power loss generally need the appropriate synchronization operations (such as
`fsync` on POSIX systems or `FlushFileBuffers` on Windows), and hardware and
filesystem guarantees also matter. NaviFS does not promise that a successful
write has been synchronously flushed to physical media.

## Memory-mapped files

Memory mapping (`mmap` on POSIX-like systems and file-mapping APIs on Windows)
lets a process access file contents through a region of its virtual address
space. The OS brings mapped pages into memory as they are accessed, often using
the same underlying file cache used for ordinary reads. Exact behavior depends
on the OS, filesystem, and mapping options. For example, a private writable
mapping may keep changes private to the process rather than writing them back
to the file.

NaviFS does not explicitly memory-map files. It uses Node.js filesystem APIs:
streamed responses are sent as files, while other response formats read file
contents into the application before processing them. Streaming can limit
application-side buffering, but neither approach disables the OS file cache.

## Eviction and limitations

The OS decides how long cached pages remain in memory. It can reclaim clean
file-backed pages when memory is needed elsewhere and can write dirty pages
back before reclaiming them. Cache replacement is more sophisticated than a
simple “keep the newest files” rule, and policies vary by platform.

Consequently, a cache hit is never guaranteed. Pages may be evicted during
memory pressure, after a restart, or because the workload accesses a larger
working set than available memory. Direct I/O, some network filesystems, and
application-specific access patterns can also change or bypass normal caching
behavior.

Caching is most useful when data is read repeatedly and the frequently used
working set fits in memory. It may have little effect for one-time sequential
reads, data larger than available memory, or workloads limited by network,
CPU, or application processing rather than storage. The cache uses memory
that could otherwise serve applications, so its benefit depends on the
workload and available resources.

## Performance and NaviFS

On repeated reads, a warm file cache can reduce storage I/O and latency. It
may also reduce storage activity and associated energy use; the impact on
device wear depends on the storage type and workload.

NaviFS relies on the host OS for this caching. In particular:

- The cache is local to the machine serving NaviFS. An HTTP client or proxy
  has its own separate cache.
- NaviFS's `Cache-Control` response header controls HTTP caches; it does not
  clear, populate, or disable the host's file cache. By default, NaviFS sends
  `Cache-Control: no-store` unless a resource has a cache-control policy.
- A streamed response avoids reading the entire file into a JavaScript string,
  but the OS may still cache file pages as it reads them.
- Non-stream responses are read into application memory before formatting.
  Their memory use is separate from the OS-managed file cache.

For performance investigations, compare cold and repeated reads under the
same workload, and observe both request latency and host storage activity.
Results depend on the OS, filesystem, available memory, and other processes.
Avoid relying on cached data for correctness or manually clearing system
caches as routine tuning; doing so often makes normal workloads slower.

## Further reading

- [Linux kernel: Page cache](https://docs.kernel.org/mm/page_cache.html)
- [Linux kernel: Page reclaim](https://docs.kernel.org/mm/page_reclaim.html)
- [Linux `mmap(2)` manual](https://man7.org/linux/man-pages/man2/mmap.2.html)
- [Microsoft: File caching](https://learn.microsoft.com/en-us/windows/win32/fileio/file-caching)
- [Node.js: File system](https://nodejs.org/api/fs.html)
