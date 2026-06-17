package com.pomo.cues

public enum class CueVariant(public val number: Int) {
    Variant1(1),
    Variant2(2),
    Variant3(3),
    ;

    public fun next(): CueVariant {
        return when (this) {
            Variant1 -> Variant2
            Variant2 -> Variant3
            Variant3 -> Variant1
        }
    }

    public companion object {
        public fun fromNumber(number: Int): CueVariant {
            return when (number) {
                2 -> Variant2
                3 -> Variant3
                else -> Variant1
            }
        }
    }
}
