import sys
import json

def mean(numbers):
    return sum(numbers) / len(numbers)

def median(numbers):
    sorted_nums = sorted(numbers)
    n = len(sorted_nums)
    mid = n // 2
    if n % 2 == 0:
        return (sorted_nums[mid] + sorted_nums[mid - 1]) / 2
    return sorted_nums[mid]

def mode(numbers):
    counts = {}
    for n in numbers:
        counts[n] = counts.get(n, 0) + 1
    max_count = max(counts.values())
    modes = [k for k, v in counts.items() if v == max_count]
    return modes[0]

def stddev(numbers):
    avg = mean(numbers)
    variance = sum((x - avg) ** 2 for x in numbers) / len(numbers)
    return variance ** 0.5

def parse_input(text):
    return [int(x) for x in text.split(",")]

def main():
    if len(sys.argv) < 2:
        print("Usage: python stats.py <comma-separated-numbers>")
        sys.exit(1)

    numbers = parse_input(sys.argv[1])

    result = {
        "count": len(numbers),
        "mean": mean(numbers),
        "median": median(numbers),
        "mode": mode(numbers),
        "stddev": stddev(numbers),
        "min": min(numbers),
        "max": max(numbers)
    }

    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
